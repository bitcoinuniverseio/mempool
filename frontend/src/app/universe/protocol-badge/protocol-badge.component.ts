import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';

@Component({
  selector: 'app-protocol-badge',
  templateUrl: './protocol-badge.component.html',
  styleUrls: ['./protocol-badge.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProtocolBadgeComponent {
  @Input() protocol: ExplorerProtocolDefinition;

  get tokenClass(): string {
    const token = this.protocol?.visualToken || this.protocol?.id || 'unknown';
    const sanitized = token.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'protocol-' + (sanitized || 'unknown');
  }
}
