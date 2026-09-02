import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SeoService } from '@app/services/seo.service';
import {
  decodePsbtInput,
  diffPsbt,
  inspectPsbt,
  looksLikeSecret,
  PsbtDiffEntry,
  PsbtInspection,
  PsbtRecord,
  serialize,
} from './psbt-inspect';
import {
  Derivation,
  FeeSummary,
  formatSats,
  readDerivations,
  summarizeAmounts,
} from './psbt-summary';

interface RecordGroup {
  readonly title: string;
  readonly index: number;
  readonly records: readonly PsbtRecord[];
}

/** How large a file this page will read, in bytes. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * The PSBT workbench.
 *
 * Everything on this page happens in the browser. Nothing is uploaded, no
 * request is made, and no signature is ever produced. That is not a policy
 * note bolted onto a feature: it is why the page can be handed a file
 * somebody is about to sign.
 *
 * The page has one job the rest of the explorer does not do: show the whole
 * container, including the parts this code does not recognise, and prove it
 * did not alter them.
 */
@Component({
  selector: 'app-psbt-workbench',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './psbt-workbench.component.html',
  styleUrls: ['./psbt-workbench.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PsbtWorkbenchComponent implements OnInit {
  input = '';
  comparison = '';
  compareMode = false;

  inspection: PsbtInspection | null = null;
  other: PsbtInspection | null = null;
  diff: PsbtDiffEntry[] | null = null;
  groups: RecordGroup[] = [];
  amounts: FeeSummary | null = null;
  derivations: Derivation[] = [];

  error: string | null = null;
  /** Set when the input was refused for looking like secret key material. */
  secretWarning: string | null = null;
  /** True once a round trip has been checked and matched. */
  roundTripVerified = false;
  /** True while a file is being dragged over the drop area. */
  dragging = false;
  /** The name of the file that was read, when one was. */
  fileName: string | null = null;

  constructor(private seo: SeoService, private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@workbench.psbt.title:PSBT workbench`);
  }

  /**
   * Reads whatever is in the box.
   *
   * The secret check runs first, before parsing and before anything is
   * stored, because the point of it is that a mistaken paste goes no further
   * than the keystroke that made it.
   */
  inspect(): void {
    this.reset();
    const secret = looksLikeSecret(this.input);
    if (secret) {
      this.secretWarning = secret;
      // Clearing the box is part of the answer. Leaving a seed phrase on
      // screen after refusing it would defeat the refusal.
      this.input = '';
      return;
    }
    try {
      const bytes = decodePsbtInput(this.input);
      const inspection = inspectPsbt(bytes);
      this.inspection = inspection;
      this.groups = this.buildGroups(inspection);
      this.amounts = summarizeAmounts(inspection);
      this.derivations = readDerivations(inspection);
      this.roundTripVerified = this.sameBytes(serialize(inspection), bytes);
      if (this.compareMode && this.comparison.trim()) {
        this.runComparison();
      }
    } catch (e) {
      this.error = e instanceof Error
        ? e.message
        : $localize`:@@workbench.psbt.unreadable:This could not be read as a PSBT.`;
    }
  }

  private runComparison(): void {
    const secret = looksLikeSecret(this.comparison);
    if (secret) {
      this.secretWarning = secret;
      this.comparison = '';
      return;
    }
    try {
      const other = inspectPsbt(decodePsbtInput(this.comparison));
      this.other = other;
      this.diff = this.inspection ? diffPsbt(this.inspection, other) : null;
    } catch (e) {
      this.error = e instanceof Error
        ? $localize`:@@workbench.psbt.compare-error:The second file could not be read: ` + e.message
        : $localize`:@@workbench.psbt.compare-unreadable:The second file could not be read.`;
    }
  }

  toggleCompare(): void {
    this.compareMode = !this.compareMode;
    if (!this.compareMode) {
      this.other = null;
      this.diff = null;
      this.comparison = '';
    }
  }

  clear(): void {
    this.input = '';
    this.comparison = '';
    this.fileName = null;
    this.reset();
  }

  /**
   * Reads a chosen file into the box.
   *
   * A PSBT is written either as raw bytes or as the base64 text of those
   * bytes, and both are in circulation. Which one a file is cannot be settled
   * by its extension, so the bytes decide: a file beginning with the magic is
   * read as bytes, and anything else is read as text and left to the decoder
   * to accept or refuse.
   */
  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) { this.readFile(file); }
    // Clearing the control means choosing the same file twice still fires.
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) { this.readFile(file); }
  }

  private readFile(file: File): void {
    this.reset();
    this.fileName = file.name;
    if (file.size > MAX_FILE_BYTES) {
      this.error = $localize`:@@workbench.psbt.file-too-large:That file is larger than this page will read. A PSBT is normally a few kilobytes.`;
      return;
    }
    file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      const isBinary = bytes.length >= 5
        && bytes[0] === 0x70 && bytes[1] === 0x73 && bytes[2] === 0x62
        && bytes[3] === 0x74 && bytes[4] === 0xff;
      if (isBinary) {
        let hex = '';
        for (const byte of bytes) { hex += byte.toString(16).padStart(2, '0'); }
        this.input = hex;
      } else {
        this.input = new TextDecoder().decode(bytes).trim();
      }
      this.inspect();
      this.cd.markForCheck();
    }).catch(() => {
      this.error = $localize`:@@workbench.psbt.file-unreadable:That file could not be read.`;
      this.cd.markForCheck();
    });
  }

  /**
   * Hands back the bytes that were read.
   *
   * Written from the records rather than from the original text, so what is
   * saved is what the breakdown above describes. The round trip check states
   * whether those are the same bytes, and it is shown next to this control
   * rather than left for someone to find.
   */
  downloadUnchanged(): void {
    if (!this.inspection) { return; }
    const bytes = serialize(this.inspection);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.fileName ?? 'transaction.psbt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private reset(): void {
    this.inspection = null;
    this.other = null;
    this.diff = null;
    this.groups = [];
    this.amounts = null;
    this.derivations = [];
    this.error = null;
    this.secretWarning = null;
    this.roundTripVerified = false;
  }

  /** Exact satoshis as a bitcoin amount, for the template. */
  sats(value: bigint | null): string {
    return value === null ? '' : formatSats(value);
  }

  trackByDerivation(index: number): number {
    return index;
  }

  private sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) { return false; }
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) { return false; }
    }
    return true;
  }

  private buildGroups(inspection: PsbtInspection): RecordGroup[] {
    const groups: RecordGroup[] = [{
      title: $localize`:@@workbench.psbt.group-global:Global`,
      index: -1,
      records: inspection.globals,
    }];
    inspection.inputs.forEach((records, index) => {
      groups.push({
        title: $localize`:@@workbench.psbt.group-input:Input ${index}`,
        index,
        records,
      });
    });
    inspection.outputs.forEach((records, index) => {
      groups.push({
        title: $localize`:@@workbench.psbt.group-output:Output ${index}`,
        index,
        records,
      });
    });
    return groups;
  }

  /** How a record's value should be shown when it is long. */
  shortValue(hex: string, keep = 32): string {
    if (!hex) { return $localize`:@@workbench.psbt.empty-value:empty`; }
    if (hex.length <= keep * 2) { return hex; }
    return `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
  }

  byteLength(hex: string): number {
    return Math.floor(hex.length / 2);
  }

  trackByGroup(_index: number, group: RecordGroup): string {
    return `${group.title}:${group.index}`;
  }

  trackByRecord(index: number, record: PsbtRecord): string {
    return `${record.scope}:${record.index}:${record.keyType}:${record.keyDataHex}:${index}`;
  }

  trackByDiff(index: number): number {
    return index;
  }
}
