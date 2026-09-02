import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { ApiService } from '@app/services/api.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RbfTree } from '@interfaces/node-api.interface';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, share, switchMap } from 'rxjs/operators';
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
 * The drawing answers "where did this value come from and where did it go".
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly electrsApi = inject(ElectrsApiService);
  private readonly apiService = inject(ApiService);
  private readonly universeApi = inject(UniverseApiService);

  /** The whole picture, or the reason there is none. */
  readonly result$ = this.route.paramMap.pipe(
    map((params) => params.get('txid') ?? ''),
    switchMap((txid) => this.load(txid)),
    share(),
  );

  readonly layout$ = this.result$.pipe(map((result) => result.graph ? layoutGraph(result.graph) : null));

  private load(txid: string): Observable<LoadResult> {
    if (!/^[0-9a-f]{64}$/i.test(txid)) {
      return of({ state: 'invalid', txid, graph: null, extras: null } as LoadResult);
    }
    return forkJoin({
      tx: this.electrsApi.getTransaction$(txid).pipe(catchError(() => of(null))),
      outspends: this.electrsApi.getOutspends$(txid).pipe(catchError(() => of([]))),
      rbf: this.apiService.getRbfHistory$(txid).pipe(catchError(() => of(null))),
      pack: this.universeApi.getMempoolPackage$(txid).pipe(catchError(() => of(null))),
    }).pipe(map(({ tx, outspends, rbf, pack }) => {
      if (!tx) {
        return { state: 'unavailable', txid, graph: null, extras: null } as LoadResult;
      }
      const anyTx = tx as any;
      const extras: SourceState = {
        rbf: (rbf as any)?.replacements ?? null,
        replaces: (rbf as any)?.replaces ?? [],
        rbfAvailable: rbf !== null,
        packageTxids: this.packageTxids(pack),
        packageAvailable: pack !== null,
      };
      const graph = buildProvenanceGraph(
        {
          txid: anyTx.txid,
          confirmed: anyTx.status?.confirmed === true,
          feeSat: typeof anyTx.fee === 'number' ? anyTx.fee : null,
          inputs: (anyTx.vin ?? [])
            .filter((vin: any) => vin?.prevout?.txid && typeof vin.prevout.vout === 'number')
            .map((vin: any) => ({
              txid: vin.prevout.txid,
              vout: vin.prevout.vout,
              valueSat: typeof vin.prevout.value === 'number' ? vin.prevout.value : 0,
            })),
          outputs: (anyTx.vout ?? [])
            .filter((vout: any) => vout && typeof vout.value === 'number')
            .map((vout: any, index: number) => ({
              vout: typeof vout.vout === 'number' ? vout.vout : index,
              valueSat: vout.value,
            })),
        },
        (outspends as any[] ?? []).map((outspend) => ({
          spent: outspend?.spent === true,
          txid: outspend?.txid ?? null,
        })),
        {
          rbfHistory: extras.rbf,
          replaces: extras.replaces,
          packageTxids: extras.packageTxids,
        },
      );
      const unavailable: string[] = [];
      if (!extras.rbfAvailable) {
        unavailable.push('Replacement history did not answer.');
      }
      if (!extras.packageAvailable && !anyTx.status?.confirmed) {
        unavailable.push('Package and cluster data did not answer.');
      }
      const stated: ProvenanceGraph = {
        ...graph,
        notes: [...graph.notes, ...unavailable],
      };
      return { state: 'ready', txid, graph: stated, extras } as LoadResult;
    }));
  }

  private packageTxids(pack: any): string[] {
    const txids = pack?.cluster?.transactions ?? pack?.cluster?.txids ?? [];
    return Array.isArray(txids)
      ? txids.map((entry: any) => typeof entry === 'string' ? entry : entry?.txid).filter(Boolean)
      : [];
  }

  nodeLabel(state: string, label: string, valueSat: number | null): string {
    const value = valueSat !== null ? `, ${valueSat} sats` : '';
    return `${state} ${label}${value}`;
  }

  open(path: string | null): void {
    if (path) {
      this.router.navigateByUrl(path);
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
  readonly state: 'ready' | 'unavailable' | 'invalid';
  readonly txid: string;
  readonly graph: ProvenanceGraph | null;
  readonly extras: SourceState | null;
}
