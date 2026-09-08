import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-zcash-viewing-key-workspace',
  templateUrl: './zcash-viewing-key-workspace.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZcashViewingKeyWorkspaceComponent {
  constructor(private seo: SeoService) {
    this.seo.setTitle('Zcash Viewing-Key Support');
  }
}
