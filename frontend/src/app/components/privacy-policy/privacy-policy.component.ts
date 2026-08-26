import { Component } from '@angular/core';
import { Env, StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';

@Component({
  selector: 'app-privacy-policy',
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.scss'],
  standalone: false,
})
export class PrivacyPolicyComponent {
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;

  constructor(
    private stateService: StateService,
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle('Privacy');
    this.seoService.setDescription('Universe Explorer has no accounts, no trackers, and no third-party data calls. What your browser remembers stays in your browser.');
  }
}
