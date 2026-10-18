import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';

/**
 * Official protocol marks (the same artwork the Universe app shows), each on a
 * fixed tile so a white mark never vanishes on the light theme or a dark one on
 * the dark theme. Protocols without an authoritative mark keep the name only.
 */
const LOGOS: Readonly<Record<string, { readonly src: string; readonly tile: 'light' | 'dark' }>> = {
  tap: { src: '/resources/universe/protocols/tap.png', tile: 'dark' },
  dmt: { src: '/resources/universe/protocols/tap.png', tile: 'dark' },
  brc20: { src: '/resources/universe/protocols/brc20.png', tile: 'light' },
  bitmap: { src: '/resources/universe/protocols/bitmap.png', tile: 'dark' },
};

@Component({
  selector: 'app-protocol-badge',
  templateUrl: './protocol-badge.component.html',
  styleUrls: ['./protocol-badge.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProtocolBadgeComponent {
  @Input() protocol: ExplorerProtocolDefinition;

  get logo(): { readonly src: string; readonly tile: 'light' | 'dark' } | null {
    return LOGOS[(this.protocol?.id || '').toLowerCase()] ?? null;
  }

  get tokenClass(): string {
    const token = this.protocol?.visualToken || this.protocol?.id || 'unknown';
    const sanitized = token.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'protocol-' + (sanitized || 'unknown');
  }
}
