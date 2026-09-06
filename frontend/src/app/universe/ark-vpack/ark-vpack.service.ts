import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface VpackImplementation {
  implementation_id: string;
  implementation_name: string;
  implementation_revision: string;
  supported_vpack_versions: string[];
  dialect_features: {
    native_extensions_supported: string[];
    fee_anchor_type: string;
    taproot_tree_style: string;
  };
}

export interface VpackOverview {
  total_vpack_versions: number;
  active_providers_count: number;
  supported_implementations: VpackImplementation[];
  recent_verified_anchors: number;
  providers: any[];
  active_versions: string[];
}

export function isVpackOverview(value: unknown): value is VpackOverview {
  const record = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item);
  const text = (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0;
  const strings = (item: unknown): item is string[] => Array.isArray(item) && item.every(text);
  if (!record(value)) { return false; }
  return ['total_vpack_versions', 'active_providers_count', 'recent_verified_anchors'].every(key =>
    typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0)
    && strings(value.active_versions) && Array.isArray(value.providers)
    && Array.isArray(value.supported_implementations) && value.supported_implementations.every(impl =>
      record(impl) && text(impl.implementation_id) && text(impl.implementation_name)
      && text(impl.implementation_revision) && strings(impl.supported_vpack_versions)
      && record(impl.dialect_features) && strings(impl.dialect_features.native_extensions_supported)
      && text(impl.dialect_features.fee_anchor_type) && text(impl.dialect_features.taproot_tree_style));
}

/**
 * Reads for this surface.
 *
 * Every call returns what the intelligence API returned, or it errors. There
 * is deliberately no fallback value: the revision this replaces answered a
 * failed request with an invented one, and on this surface that included a
 * verification reporting itself verified. A reader who cannot tell a checked
 * result from an unchecked one has nothing.
 */
@Injectable({
  providedIn: 'root',
})
export class ArkVpackApiService {
  private readonly baseUrl = '/api/v1/intelligence/ark/vpack';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<VpackOverview> {
    return this.http.get<VpackOverview>(`${this.baseUrl}/overview`);
  }

  public getProviders$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/providers`);
  }
}
