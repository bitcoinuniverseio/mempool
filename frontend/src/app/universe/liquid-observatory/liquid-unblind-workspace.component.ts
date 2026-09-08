import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-liquid-unblind-workspace',
  templateUrl: './liquid-unblind-workspace.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidUnblindWorkspaceComponent {
  constructor(private seo: SeoService) {
    this.seo.setTitle('Liquid Unblinding Support');
  }
}
