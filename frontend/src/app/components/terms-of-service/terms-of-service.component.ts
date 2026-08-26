import { Component } from '@angular/core';
import { Env, StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-terms-of-service',
  templateUrl: './terms-of-service.component.html',
  styleUrls: ['./terms-of-service.component.scss'],
  standalone: false,
})
export class TermsOfServiceComponent {
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;

  constructor(
    private stateService: StateService,
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle('Terms of use');
    this.seoService.setDescription('Universe Explorer is a free, read-only Bitcoin and protocol explorer, provided with no warranty and no advertising.');
  }
}
