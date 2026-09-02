import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RpcMethod, RpcResult } from './node-console.types';
import { firstArgumentProblem, groupByCategory, searchMethods } from './node-view';

/**
 * The read only method catalog, and a way to call one.
 *
 * The catalog is the allowlist itself, fetched from the server rather than
 * repeated here, so the page cannot claim a method the server would refuse
 * and cannot omit one it would accept.
 *
 * Arguments are checked here before they are sent, purely so a mistake is
 * reported next to the field that caused it. The server rechecks everything,
 * and the server is the authority.
 */
@Component({
  selector: 'app-node-rpc',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './node-rpc.component.html',
  styleUrls: ['./node-console.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeRpcComponent implements OnInit, OnDestroy {
  methods: RpcMethod[] = [];
  groups: { category: string; methods: RpcMethod[] }[] = [];
  note = '';
  query = '';

  selected: RpcMethod | null = null;
  /** One box per declared parameter, by position. */
  values: string[] = [];
  argumentProblem: { index: number; message: string } | null = null;

  result: RpcResult | null = null;
  resultJson = '';
  error: string | null = null;
  running = false;
  loading = true;

  private catalogSubscription: Subscription | null = null;
  private callSubscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@node.rpc.title:Ask this node`);
    this.catalogSubscription = this.api.getRpcCatalog$().subscribe({
      next: (catalog) => {
        this.methods = catalog.methods;
        this.note = catalog.note;
        this.applyFilter();
        this.loading = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = $localize`:@@node.rpc.no-catalog:The list of methods could not be fetched.`;
        this.cd.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.catalogSubscription?.unsubscribe();
    this.callSubscription?.unsubscribe();
  }

  applyFilter(): void {
    this.groups = groupByCategory(searchMethods(this.methods, this.query));
  }

  choose(method: RpcMethod): void {
    this.selected = method;
    this.values = method.params.map(() => '');
    this.argumentProblem = null;
    this.result = null;
    this.resultJson = '';
    this.error = null;
  }

  run(): void {
    if (!this.selected) { return; }
    this.error = null;
    this.result = null;
    this.resultJson = '';
    this.argumentProblem = firstArgumentProblem(this.selected.params, this.values);
    if (this.argumentProblem) { return; }

    // Blank trailing arguments are dropped rather than sent as empty, because
    // the node reads them by position and an empty string is not an absence.
    const args: string[] = [];
    for (const value of this.values) {
      const trimmed = value.trim();
      if (!trimmed) { break; }
      args.push(trimmed);
    }

    this.running = true;
    this.callSubscription?.unsubscribe();
    this.callSubscription = this.api.callNodeRpc$(this.selected.name, args).subscribe({
      next: (result) => {
        this.result = result;
        this.resultJson = JSON.stringify(result.result, null, 2);
        this.running = false;
        this.cd.markForCheck();
      },
      error: (error) => {
        this.running = false;
        const message = error?.error?.error ?? error?.error;
        this.error = typeof message === 'string' && message.length < 600
          ? message
          : $localize`:@@node.rpc.call-failed:That call did not answer.`;
        this.cd.markForCheck();
      },
    });
  }

  clear(): void {
    this.selected = null;
    this.values = [];
    this.result = null;
    this.resultJson = '';
    this.error = null;
    this.argumentProblem = null;
  }

  problemFor(index: number): string | null {
    return this.argumentProblem?.index === index ? this.argumentProblem.message : null;
  }

  trackByName(_index: number, method: RpcMethod): string {
    return method.name;
  }

  trackByCategory(_index: number, group: { category: string }): string {
    return group.category;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
