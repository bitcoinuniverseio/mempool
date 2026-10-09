import { ExplorerProtocolDefinition } from './universe.types';

/**
 * The current registry carries historical declarations, source-contract
 * descriptors and an optional global acceptance aggregate. None supplies
 * per-protocol evidence/counts bound to the selected network and registry
 * revision. Readiness, a checkpoint or PASS in those fields cannot fill that
 * contract gap. Keep functional coverage unverified until that contract exists.
 */
export function protocolCoverageView(protocol: ExplorerProtocolDefinition): {
  functionalLabel: string;
  functionalKnown: false;
  historicalLabel: string | null;
} {
  const declaration = typeof protocol.coverage === 'string'
    ? protocol.coverage
    : typeof protocol.coverage?.state === 'string' ? protocol.coverage.state : null;
  const historical = declaration?.trim();
  const label = historical
    ? historical.replace(/[_-]/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
    : null;
  return {
    functionalLabel: $localize`:@@universe.protocols.functional-unverified:Functional coverage: Unverified`,
    functionalKnown: false,
    historicalLabel: label
      ? $localize`:@@universe.protocols.historical-declaration:Historical registry declaration: ${label}:declaration:`
      : null,
  };
}
