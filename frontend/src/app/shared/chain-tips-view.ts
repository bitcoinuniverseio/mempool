import { StaleTip } from '@interfaces/node-api.interface';

/**
 * A stale tip as the reorg page shows it.
 *
 * The upstream interface names its sides with a word this product keeps out
 * of its own vocabulary, so the mapping to display names happens here, once,
 * in the one place that has to touch the wire shape.
 */
export interface DisplacementView {
  readonly staleId: string;
  readonly staleHeight: number;
  readonly displacedById: string;
  readonly displacedAt: number | null;
}

export function toDisplacementView(tip: StaleTip): DisplacementView {
  return {
    staleId: tip.stale.id,
    staleHeight: tip.stale.height,
    displacedById: tip.canonical.id,
    displacedAt: tip.canonical.timestamp ? tip.canonical.timestamp * 1000 : null,
  };
}

export function toDisplacementViews(tips: readonly StaleTip[]): readonly DisplacementView[] {
  return tips.map(toDisplacementView);
}
