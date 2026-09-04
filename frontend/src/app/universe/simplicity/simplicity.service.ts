import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface SimplicityProgram {
  program_id: string;
  cmr: string;
  imr: string;
  amr: string;
  program_type: string;
  source_name?: string;
  jets_used: string[];
  static_cost_weight: number;
  memory_bound_bytes: number;
  is_formally_verified: boolean;
  first_seen_height?: number;
  occurrences_count: number;
}

export interface SimplicityToolchain {
  toolchain_id: string;
  version: string;
  libsimplicity_commit: string;
  simplicityhl_version: string;
  status: 'production_liquid' | 'experimental_tooling' | 'deprecated';
  release_date: string;
}

export interface SimplicityOverview {
  total_programs: number;
  total_occurrences: number;
  formally_verified_count: number;
  jets_catalog_size: number;
  supported_toolchains: SimplicityToolchain[];
  featured_programs: SimplicityProgram[];
}

@Injectable({
  providedIn: 'root',
})
export class SimplicityApiService {
  private apiBaseUrl = '';

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {
    if (!this.stateService.isBrowser && this.stateService.env) {
      this.apiBaseUrl =
        this.stateService.env.NGINX_PROTOCOL +
        '://' +
        this.stateService.env.NGINX_HOSTNAME +
        ':' +
        this.stateService.env.NGINX_PORT;
    }
  }

  getOverview$(): Observable<SimplicityOverview> {
    return this.httpClient.get<SimplicityOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/overview`
    );
  }

  getPrograms$(): Observable<SimplicityProgram[]> {
    return this.httpClient.get<SimplicityProgram[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/programs`
    );
  }

  getProgramById$(programId: string): Observable<SimplicityProgram> {
    return this.httpClient.get<SimplicityProgram>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/programs/${encodeURIComponent(programId)}`
    );
  }

  getTransactionExecution$(txid: string): Observable<any> {
    return this.httpClient.get<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/transactions/${encodeURIComponent(txid)}`
    );
  }

  getToolchains$(): Observable<SimplicityToolchain[]> {
    return this.httpClient.get<SimplicityToolchain[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/toolchains`
    );
  }

  decodeProgram$(programHex: string): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/programs/decode`,
      { program_hex: programHex }
    );
  }

  verifyFormalProof$(proofPackage: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/simplicity/formal-artifacts/verify`,
      proofPackage
    );
  }
}
