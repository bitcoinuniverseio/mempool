import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SeoService } from '@app/services/seo.service';
import { ScriptWorkbenchComponent } from '../intelligence-platform/script-workbench.component';

/** Both entry points use the same real engine contracts and request lifecycle. */
@Component({
  selector: 'app-script-studio',
  templateUrl: './script-studio.component.html',
  standalone: true,
  imports: [ScriptWorkbenchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScriptStudioComponent {
  constructor(seo: SeoService) {
    seo.setTitle('Bitcoin Script, Miniscript & Taproot Studio');
  }
}
