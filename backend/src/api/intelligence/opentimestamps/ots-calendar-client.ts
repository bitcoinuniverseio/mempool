import axios from 'axios';
import { TimestampEvidenceError } from './opentimestamps-errors';
import { OtsTimestamp, parseTimestamp } from './ots-timestamp';

/**
 * The calendar directory and its client.
 *
 * A calendar is only ever contacted when its URL is on this allowlist. A
 * pending attestation inside a proof names a URL, and that URL is looked up
 * here and never fetched on its own authority: a proof that points at an
 * unknown host gets a truthful "unreachable" for that attestation, not a
 * request to whatever host it named.
 *
 * Protocol, from python-opentimestamps client/calendar.py:
 *   POST <url>/digest            body: the raw commitment bytes
 *                                answer: a serialized timestamp for them
 *   GET  <url>/timestamp/<hex>   answer: a serialized timestamp for that
 *                                commitment, or 404 while the calendar is
 *                                still waiting for its Bitcoin transaction
 */
export interface CalendarDirectoryEntry {
  calendar_id: string;
  name: string;
  url: string;
}

const ACCEPT = 'application/vnd.opentimestamps.v1';
const USER_AGENT = 'universe-explorer-opentimestamps/1.0';
const RESPONSE_LIMIT_BYTES = 64 * 1024;

export interface CalendarHttp {
  post(url: string, body: Buffer, timeoutMs: number): Promise<{ status: number; body: Buffer }>;
  get(url: string, timeoutMs: number): Promise<{ status: number; body: Buffer }>;
}

// Rejections surface to the client, which names the calendar in its error.
const axiosHttp: CalendarHttp = {
  post(url, body, timeoutMs) {
    return axios.post(url, body, {
      timeout: timeoutMs, responseType: 'arraybuffer', maxContentLength: RESPONSE_LIMIT_BYTES, maxRedirects: 0,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: ACCEPT, 'User-Agent': USER_AGENT },
    }).then(response => ({ status: response.status, body: Buffer.from(response.data) }));
  },
  get(url, timeoutMs) {
    return axios.get(url, {
      timeout: timeoutMs, responseType: 'arraybuffer', maxContentLength: RESPONSE_LIMIT_BYTES, maxRedirects: 0,
      validateStatus: () => true,
      headers: { Accept: ACCEPT, 'User-Agent': USER_AGENT },
    }).then(response => ({ status: response.status, body: Buffer.from(response.data) }));
  },
};

/**
 * Read the allowlist from the environment. There is no default: a deployment
 * names the calendars it runs or trusts for its own network, and one that
 * names none has no calendar. The service reports that as unconfigured rather
 * than quietly submitting digests to a public calendar on another network.
 */
export function calendarDirectoryFromEnvironment(value: string | undefined = process.env.UNIVERSE_OPENTIMESTAMPS_CALENDARS): CalendarDirectoryEntry[] {
  if (value === undefined || value.trim() === '') {return [];}
  const entries: CalendarDirectoryEntry[] = [];
  for (const raw of value.split(',')) {
    const item = raw.trim();
    if (!item) {continue;}
    const [left, right] = item.includes('=') ? [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)] : [undefined, item];
    let url: URL;
    try { url = new URL(right.trim()); } catch { throw new Error(`UNIVERSE_OPENTIMESTAMPS_CALENDARS contains a malformed URL: ${right}`); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {throw new Error(`UNIVERSE_OPENTIMESTAMPS_CALENDARS allows only http(s) calendars: ${right}`);}
    const normalized = url.origin + url.pathname.replace(/\/+$/, '');
    const id = (left?.trim() || url.hostname).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    entries.push({ calendar_id: id, name: left?.trim() || url.hostname, url: normalized });
  }
  return entries;
}

export class CalendarClient {
  constructor(
    private readonly directory: CalendarDirectoryEntry[],
    private readonly http: CalendarHttp = axiosHttp,
    private readonly timeoutMs = 10000,
  ) {}

  /** False when the deployment named no calendar; nothing is contacted then. */
  public get configured(): boolean {
    return this.directory.length > 0;
  }

  public list(): CalendarDirectoryEntry[] {
    return this.directory.map(entry => ({ ...entry }));
  }

  public byId(calendarId: string): CalendarDirectoryEntry | undefined {
    return this.directory.find(entry => entry.calendar_id === calendarId);
  }

  /** The directory entry a pending attestation URI belongs to, if any. */
  public match(uri: string): CalendarDirectoryEntry | undefined {
    let parsed: URL;
    try { parsed = new URL(uri); } catch { return undefined; }
    const normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    return this.directory.find(entry => entry.url === normalized);
  }

  /**
   * Submit a commitment. The answer is the calendar's timestamp for exactly
   * those bytes; an answer that commits to anything else is rejected. @asyncUnsafe */
  public async submit(entry: CalendarDirectoryEntry, commitment: Buffer): Promise<OtsTimestamp> {
    this.requireListed(entry);
    let response: { status: number; body: Buffer };
    try {
      response = await this.http.post(`${entry.url}/digest`, commitment, this.timeoutMs);
    } catch (error) {
      throw new TimestampEvidenceError('calendar-unreachable', `Calendar ${entry.calendar_id} did not answer: ${describe(error)}`);
    }
    if (response.status !== 200) {
      throw new TimestampEvidenceError('calendar-unreachable', `Calendar ${entry.calendar_id} answered HTTP ${response.status} to the digest submission.`);
    }
    return this.parseAnswer(entry, response.body, commitment);
  }

  /**
   * Ask a calendar for the timestamp of a commitment it previously accepted.
   * Returns null while the calendar has nothing newer than a pending promise. @asyncUnsafe */
  public async upgrade(entry: CalendarDirectoryEntry, commitment: Buffer): Promise<OtsTimestamp | null> {
    this.requireListed(entry);
    let response: { status: number; body: Buffer };
    try {
      response = await this.http.get(`${entry.url}/timestamp/${commitment.toString('hex')}`, this.timeoutMs);
    } catch (error) {
      throw new TimestampEvidenceError('calendar-unreachable', `Calendar ${entry.calendar_id} did not answer: ${describe(error)}`);
    }
    if (response.status === 404) {return null;}
    if (response.status !== 200) {
      throw new TimestampEvidenceError('calendar-unreachable', `Calendar ${entry.calendar_id} answered HTTP ${response.status} to the upgrade request.`);
    }
    return this.parseAnswer(entry, response.body, commitment);
  }

  private parseAnswer(entry: CalendarDirectoryEntry, body: Buffer, commitment: Buffer): OtsTimestamp {
    if (!body.length || body.length > RESPONSE_LIMIT_BYTES) {
      throw new TimestampEvidenceError('calendar-invalid-answer', `Calendar ${entry.calendar_id} returned an empty or oversized timestamp.`);
    }
    try {
      return parseTimestamp(body, commitment);
    } catch (error) {
      throw new TimestampEvidenceError('calendar-invalid-answer', `Calendar ${entry.calendar_id} returned a timestamp that does not parse: ${describe(error)}`);
    }
  }

  private requireListed(entry: CalendarDirectoryEntry): void {
    if (!this.directory.some(listed => listed.url === entry.url && listed.calendar_id === entry.calendar_id)) {
      throw new TimestampEvidenceError('calendar-not-allowlisted', `Calendar ${entry.calendar_id} is not on the allowlist.`, 400);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {return error.message;}
  return String(error);
}
