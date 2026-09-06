import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { newLocalId, type LocalManualEntry } from '../stores/portfolio-model';
import { formatExact, maskedValue } from '../shared/exact';
import { manualPositionError, manualPositionValue, type ManualPositionDraft } from './manual-positions';

@Component({
  selector: 'app-manual-positions',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="manual" aria-label="Manual positions">
      <h2>Manual positions</h2>
      <p class="soft">User-entered records, kept in this encrypted vault. Quantities and prices are your estimates, not verified balances or price feeds. They stay separate from address-derived holdings and totals.</p>
      @if (entries().length > 0) {
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">Position</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Estimated value</th><th scope="col">As of</th><th scope="col">Actions</th></tr></thead>
          <tbody>@for (entry of entries(); track entry.id) {
            <tr><td>{{ entry.name }}</td><td>{{ entry.kind }}</td><td>{{ hidden() ? mask : entry.quantity }}</td>
              <td>{{ hidden() ? mask : value(entry) }} {{ hidden() ? '' : entry.quoteCurrency }}</td><td>{{ entry.effectiveAt.slice(0, 10) }}</td>
              <td class="actions"><button type="button" (click)="edit(entry)" [disabled]="busy() || hidden()">Edit</button><button type="button" (click)="remove(entry.id)" [disabled]="busy()">Remove</button></td></tr>
          }</tbody>
        </table></div>
      }
      @if (!hidden()) {
      <details [open]="editing().length > 0">
        <summary>{{ editing() ? 'Edit manual position' : 'Add manual position' }}</summary>
        <form (ngSubmit)="save()" #form="ngForm">
          <label>Position name<input name="name" [(ngModel)]="draft.name" maxlength="120" required /></label>
          <label>Position type<select name="kind" [(ngModel)]="draft.kind"><option value="asset">Asset</option><option value="liability">Liability</option></select></label>
          <label>Exact quantity<input name="quantity" [(ngModel)]="draft.quantity" inputmode="decimal" maxlength="79" required /></label>
          <label>Unit price (optional)<input name="unitPrice" [(ngModel)]="draft.unitPrice" inputmode="decimal" maxlength="79" /></label>
          <label>Price currency<input name="quoteCurrency" [(ngModel)]="draft.quoteCurrency" maxlength="12" placeholder="USD" /></label>
          <label>Effective date<input name="effectiveAt" [(ngModel)]="draft.effectiveAt" type="date" required /></label>
          <div class="actions"><button type="submit" [disabled]="busy() || !form.valid">{{ busy() ? 'Saving…' : 'Save manual position' }}</button>
            @if (editing()) { <button type="button" (click)="reset()" [disabled]="busy()">Cancel edit</button> }
          </div>
        </form>
      </details>
      } @else { <p class="soft">Show values to add or edit a manual position.</p> }
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (message()) { <p role="status">{{ message() }}</p> }
    </section>
  `,
  styles: [`
    .manual { border: 1px solid var(--u-separator, rgba(0,0,0,0.12)); border-radius: 12px; padding: 16px; }
    h2 { font-size: 16px; margin: 0 0 8px; } .soft { color: var(--u-fg-soft, inherit); font-size: 13px; }
    .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.12)); }
    form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding-top: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    input, select, button { min-height: 40px; min-width: 0; border: 1px solid var(--u-separator, rgba(0,0,0,0.2)); border-radius: 7px; padding: 8px; background: var(--u-surface, transparent); color: inherit; font: inherit; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; } button, summary { cursor: pointer; } summary { padding-top: 12px; min-height: 44px; }
    [role=alert] { color: var(--u-danger, #b02020); }
    @media print { details, .actions { display: none; } }
  `],
})
export class ManualPositionsComponent {
  private readonly store = inject(PortfoliosStore);
  readonly hidden = inject(PortfolioSessionService).valuesHidden;
  readonly entries = computed(() => this.store.activePortfolio()?.manualEntries ?? []);
  readonly busy = signal(false);
  readonly editing = signal('');
  readonly error = signal('');
  readonly message = signal('');
  readonly mask = maskedValue();
  draft: ManualPositionDraft = this.emptyDraft();

  constructor() {
    let portfolioId: string | null = null;
    effect(() => {
      const next = this.store.activePortfolio()?.id ?? null;
      if (next !== portfolioId) { portfolioId = next; this.reset(); }
      if (this.hidden()) { this.reset(); }
    });
  }

  value(entry: LocalManualEntry): string {
    const value = manualPositionValue(entry);
    return value === null ? 'Unpriced' : formatExact(value, 'en');
  }

  edit(entry: LocalManualEntry): void {
    if (this.hidden() || this.busy()) { return; }
    this.editing.set(entry.id);
    this.draft = { name: entry.name, kind: entry.kind, quantity: entry.quantity, unitPrice: entry.unitPrice ?? '', quoteCurrency: entry.quoteCurrency ?? '', effectiveAt: entry.effectiveAt.slice(0, 10) };
    this.error.set(''); this.message.set('');
  }

  reset(): void {
    this.editing.set(''); this.draft = this.emptyDraft(); this.error.set(''); this.message.set('');
  }

  async save(): Promise<void> {
    if (this.busy() || this.hidden()) { return; }
    const portfolio = this.store.activePortfolio();
    if (!portfolio) { return; }
    const error = manualPositionError(this.draft);
    if (error) { this.error.set(error); return; }
    const editing = this.editing();
    const existing = portfolio.manualEntries.find(entry => entry.id === editing);
    const entry: LocalManualEntry = {
      ...existing, id: editing || newLocalId(), name: this.draft.name.trim(), kind: this.draft.kind,
      quantity: this.draft.quantity, unitPrice: this.draft.unitPrice || undefined,
      quoteCurrency: this.draft.unitPrice ? this.draft.quoteCurrency.trim().toUpperCase() : undefined,
      effectiveAt: this.draft.effectiveAt + 'T00:00:00.000Z', tags: existing?.tags ?? [], authority: 'user', includedInCombined: false,
    };
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      await this.store.updatePortfolio(portfolio.id, current => ({ ...current,
        manualEntries: editing ? current.manualEntries.map(value => value.id === editing ? entry : value) : [...current.manualEntries, entry],
      }));
      if (this.store.activePortfolio()?.id === portfolio.id) { this.reset(); this.message.set('Manual position saved in this encrypted vault.'); }
    } catch { this.error.set('The position could not be saved. Unlock the vault and try again.'); }
    finally { this.busy.set(false); }
  }

  async remove(id: string): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (!portfolio || this.busy()) { return; }
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      await this.store.updatePortfolio(portfolio.id, current => ({ ...current, manualEntries: current.manualEntries.filter(entry => entry.id !== id) }));
      if (this.store.activePortfolio()?.id === portfolio.id) { this.reset(); this.message.set('Manual position removed from this vault.'); }
    } catch { this.error.set('The position could not be removed. Unlock the vault and try again.'); }
    finally { this.busy.set(false); }
  }

  private emptyDraft(): ManualPositionDraft {
    return { name: '', kind: 'asset', quantity: '', unitPrice: '', quoteCurrency: '', effectiveAt: new Date().toISOString().slice(0, 10) };
  }
}
