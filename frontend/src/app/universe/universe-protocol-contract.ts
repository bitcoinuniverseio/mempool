import type { ExplorerProtocolActivityPage, ExplorerProtocolObjectsPage } from './universe.types';

export type ProtocolPageKind = 'activity' | 'objects';
type ProtocolPage = ExplorerProtocolActivityPage | ExplorerProtocolObjectsPage;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableText(value: unknown): boolean {
  return value === null || text(value);
}

function timestamp(value: unknown): boolean {
  return text(value) && Number.isFinite(Date.parse(value));
}

function cursor(value: unknown): boolean {
  return value === null || (text(value) && value.length <= 512);
}

function checkpoint(value: unknown): boolean {
  return value === null || (record(value) && text(value.heightAtomic) && /^(0|[1-9][0-9]*)$/.test(value.heightAtomic)
    && text(value.blockHash) && /^[a-fA-F0-9]{64}$/.test(value.blockHash) && timestamp(value.observedAt));
}

/** Mirrors the owned activity/objects contracts and their state-specific service results. */
function validPage(kind: ProtocolPageKind, value: unknown, protocolId: string): value is ProtocolPage {
  if (!record(value) || value.schemaVersion !== `universe-protocol-${kind}-v1` || value.protocolId !== protocolId
    || !['served', 'unconfigured', 'unavailable', 'unsupported'].includes(value.state as string)
    || !cursor(value.nextCursor) || !checkpoint(value.checkpoint)
    || !(timestamp(value.observedAt) || (value.state === 'unsupported' && value.observedAt === null))) {
    return false;
  }
  const arrays = kind === 'activity' ? ['assets', 'events', 'invalidations', 'holderSnapshots'] : ['items'];
  if (!arrays.every((key) => Array.isArray(value[key]) && (value[key] as unknown[]).every(record))) {return false;}
  const path = value[kind === 'activity' ? 'feedPath' : 'objectsPath'];
  if (kind === 'activity' && (typeof value.hasMore !== 'boolean' || (value.hasMore && value.nextCursor === null))) {return false;}

  if (value.state === 'served') {
    if (!text(value.authorityId) || !text(path) || !/^\/[A-Za-z0-9/_.-]{1,127}$/.test(path) || value.degradedReason !== null) {return false;}
    if (kind === 'activity') {
      const source = value.source;
      // The feed client requires an id; optional source fields remain unknown when null.
      // Source protocol labels are authority-owned (for example op20 serves op_names).
      if (!record(source) || !text(source.id)
        || !['protocol', 'chain', 'network', 'coverage', 'cursor', 'asOf'].every((key) => nullableText(source[key]))) {return false;}
    }
    return true;
  }

  if (!text(value.degradedReason) || value.nextCursor !== null || value.checkpoint !== null
    || !arrays.every((key) => (value[key] as unknown[]).length === 0)
    || (kind === 'activity' && (value.source !== null || value.hasMore !== false))) {return false;}
  return value.state === 'unsupported' ? value.authorityId === null && path === null
    : text(value.authorityId) && text(path) && /^\/[A-Za-z0-9/_.-]{1,127}$/.test(path);
}

export function readProtocolPage(kind: 'activity', value: unknown, protocolId: string): ExplorerProtocolActivityPage;
export function readProtocolPage(kind: 'objects', value: unknown, protocolId: string): ExplorerProtocolObjectsPage;
export function readProtocolPage(kind: ProtocolPageKind, value: unknown, protocolId: string): ProtocolPage;
export function readProtocolPage(kind: ProtocolPageKind, value: unknown, protocolId: string): ProtocolPage {
  if (!validPage(kind, value, protocolId)) {throw new Error(`protocol-${kind}-contract-mismatch`);}
  return value;
}

/**
 * The controller's unsupported 404 body has exactly these four fields. Adapt
 * only that explicit declaration for page consumers, retaining its reason and
 * leaving observation/checkpoint evidence unknown. Arbitrary 404s stay errors.
 */
export function readProtocolFailure(kind: ProtocolPageKind, error: unknown, protocolId: string): ProtocolPage {
  if (!record(error) || !record(error.error)) {throw error;}
  const body = error.error;
  if (error.status === 404 && body.state === 'unsupported'
    && body.schemaVersion === `universe-protocol-${kind}-v1` && body.protocolId === protocolId
    && text(body.degradedReason)
    && Object.keys(body).every((key) => ['schemaVersion', 'protocolId', 'state', 'degradedReason'].includes(key))) {
    const common = { ...body, authorityId: null, nextCursor: null, checkpoint: null, observedAt: null };
    return readProtocolPage(kind, kind === 'activity' ? {
      ...common, feedPath: null, source: null, assets: [], events: [], invalidations: [], holderSnapshots: [], hasMore: false,
    } : { ...common, objectsPath: null, items: [] }, protocolId);
  }
  if (((error.status === 404 && body.state === 'unsupported') || (error.status === 502 && body.state === 'unavailable'))
    && validPage(kind, body, protocolId)) {return body;}
  throw error;
}
