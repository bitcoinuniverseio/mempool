import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

interface ScanResult {
  readonly addressType: 'unified' | 'sapling' | 'transparent' | 'invalid';
  readonly receivers: readonly string[];
  readonly scannedBlocks: number;
  readonly notesFound: number;
  readonly totalZatoshis: string;
}

@Component({
  selector: 'app-zcash-viewing-key-workspace',
  templateUrl: './zcash-viewing-key-workspace.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZcashViewingKeyWorkspaceComponent {
  viewingKey = '';
  startHeight = 2500000;
  scanning = false;

  private readonly resultSubject = new BehaviorSubject<ScanResult | null>(null);
  readonly result$: Observable<ScanResult | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('Zcash Client-Only Viewing-Key Workspace');
  }

  scan(): void {
    const key = this.viewingKey.trim();
    if (!key) return;

    this.scanning = true;
    setTimeout(() => {
      this.scanning = false;
      const isUnified = key.startsWith('uview') || key.startsWith('u1');
      const isSapling = key.startsWith('zxviews') || key.startsWith('zs1');

      this.resultSubject.next({
        addressType: isUnified ? 'unified' : isSapling ? 'sapling' : 'invalid',
        receivers: isUnified ? ['Orchard (Halo 2)', 'Sapling (Groth16)', 'P2PKH (Transparent)'] : ['Sapling'],
        scannedBlocks: 1000,
        notesFound: 0,
        totalZatoshis: '0',
      });
    }, 400);
  }
}
