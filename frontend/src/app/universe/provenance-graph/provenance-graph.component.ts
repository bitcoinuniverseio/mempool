import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { ApiService } from '@app/services/api.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { StateService } from '@app/services/state.service';
import { readGraphTransaction, readGraphOutspends, readGraphReplacements, readGraphPackage } from './provenance-sources';
import { RbfTree } from '@interfaces/node-api.interface';
import { Observable, combineLatest, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, startWith, switchMap, take } from 'rxjs/operators';
import {
  GraphEdge,
  ProvenanceGraph,
  buildProvenanceGraph,
  graphCsv,
  graphJson,
  layoutGraph,
} from './provenance-graph';

/**
 * The provenance of one transaction, drawn and stated.
 *
 * The drawing shows observed transaction input and output connections; it does not infer ownership.
 * The table beside it carries the identical facts for anyone who reads
 * tables, and the exports carry them as data. Every node links to the object
 * it stands for, so the graph is a set of doors rather than a picture.
 *
 * Each source fails alone. A transaction whose replacement history or
 * package cannot be read still shows its value flow, with a note saying
 * exactly what was unavailable, because a missing extra is not a missing
 * graph.
 */

interface SourceState {
  readonly rbf: RbfTree | null;
  readonly replaces: readonly string[];
  readonly rbfAvailable: boolean;
  readonly packageTxids: readonly string[];
  readonly packageAvailable: boolean;
}

@Component({
  selector: 'app-universe-provenance-graph',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
  templateUrl: './provenance-graph.component.html',
  styleUrls: ['./provenance-graph.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvenanceGraphComponent {
  private readonly network = inject(StateService);
  private selectedNetwork = this.network.network;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly electrsApi = inject(ElectrsApiService);
  private readonly apiService = inject(ApiService);
  private readonly universeApi = inject(UniverseApiService);

  /** The whole picture, or the reason there is none. */
  readonly result$ = combineLatest([
    this.route.paramMap.pipe(map(params => (params.get('txid') ?? '').toLowerCase())),
    this.network.networkChanged$.pipe(startWith(this.network.network), distinctUntilChanged()),
  ]).pipe(
    distinctUntilChanged(([oldId, oldNetwork], [id, network]) => oldId === id && oldNetwork === network),
    switchMap(([txid, network]) => {
      this.selectedNetwork = network;
      return this.load(txid).pipe(startWith({ state: 'loading', txid, graph: null, extras: null } as LoadResult));
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly layout$ = this.result$.pipe(map((result) => result.graph ? layoutGraph(result.graph) : null));

  private load(txid: string): Observable<LoadResult> {
    if (!/^[0-9a-f]{64}$/i.test(txid)) {
      return of({ state: 'invalid', txid, graph: null, extras: null } as LoadResult);
    }
    return forkJoin({
      tx: this.electrsApi.getTransaction$(txid).pipe(take(1), catchError(() => of(null))),
      outspends: this.electrsApi.getOutspends$(txid).pipe(take(1), catchError(() => of(null))),
      rbf: this.apiService.getRbfHistory$(txid).pipe(take(1), catchError(() => of(null))),
      pack: this.universeApi.getMempoolPackage$(txid).pipe(take(1), catchError(() => of(null))),
    }).pipe(map(({ tx, outspends, rbf, pack }) => {
      const transaction = readGraphTransaction(tx, txid);
      if (!transaction) {
        return { state: 'unavailable', txid, graph: null, extras: null } as LoadResult;
      }
      const history = readGraphReplacements(rbf, txid);
      const packageIds = readGraphPackage(pack, txid);
      const extras: SourceState = {
        rbf: history.rbf, replaces: history.replaces, rbfAvailable: history.available,
        packageTxids: packageIds ?? [], packageAvailable: packageIds !== null,
      };
      const graph = buildProvenanceGraph(transaction, readGraphOutspends(outspends, transaction.outputs.length), {
        rbfHistory: extras.rbf, replaces: extras.replaces, packageTxids: extras.packageTxids,
      });
      const unavailable: string[] = [];
      if (!extras.rbfAvailable) { unavailable.push('Replacement history was unavailable or invalid.'); }
      if (!extras.packageAvailable && transaction.confirmed === false) {
        unavailable.push('Current package and cluster data was unavailable.');
      }
      const stated: ProvenanceGraph = {
        ...graph,
        notes: [...graph.notes, ...unavailable],
      };
      return { state: 'ready', txid, graph: stated, extras } as LoadResult;
    }));
  }

  nodeLabel(state: string, label: string, valueSat: number | null): string {
    const value = valueSat !== null ? `, ${valueSat} sats` : '';
    return `${state} ${label}${value}`;
  }

  networkPath(path: string | null): string | null {
    return path ? `${this.selectedNetwork ? '/' + this.selectedNetwork : ''}${path}` : null;
  }

  open(path: string | null): void {
    if (path) {
      this.router.navigateByUrl(this.networkPath(path));
    }
  }

  download(graph: ProvenanceGraph, format: 'json' | 'csv'): void {
    const content = format === 'json' ? graphJson(graph) : graphCsv(graph);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `provenance-${graph.nodes.find((node) => node.kind === 'transaction')?.path.split('/').pop() ?? 'graph'}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Edge arrowheads and strokes by kind, stated in words as well as shape. */
  edgeClass(kind: GraphEdge['kind']): string {
    return `edge-${kind}`;
  }

  edgeWord(kind: GraphEdge['kind']): string {
    switch (kind) {
      case 'input': return 'spent by this transaction';
      case 'output': return 'created this output';
      case 'spend': return 'was spent by';
      case 'replacement': return 'was replaced by';
      case 'package': return 'shares a package with';
    }
  }
}

interface LoadResult {
  readonly state: 'loading' | 'ready' | 'unavailable' | 'invalid';
  readonly txid: string;
  readonly graph: ProvenanceGraph | null;
  readonly extras: SourceState | null;
}
