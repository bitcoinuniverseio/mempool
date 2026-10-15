import { describe, expect, it } from 'vitest';
import { StartComponent } from './start.component';

// Gap between each screen edge and the nearest whole card once a marked block has landed.
function edgeGaps(
  width: number,
  isMobile: boolean
): { left: number; right: number } {
  const component = Object.create(StartComponent.prototype);
  Object.assign(component, {
    blockWidth: 155,
    chainWidth: width,
    isMobile,
    blockchainContainer: { nativeElement: { clientWidth: width } },
  });
  const offset = component.getMarkOffset();
  expect(Math.abs(offset)).toBeLessThanOrEqual(77.5);
  const translation = isMobile ? width * 0.95 : width * 0.5;
  const slot = translation + offset - (isMobile ? 155 : 0);
  const left = (((slot + 20) % 155) + 155) % 155;
  return { left, right: width - left - 155 * Math.floor((width - left) / 155) };
}

describe('marked block landing', () => {
  it('keeps every card whole on a 1440px screen', () => {
    expect(edgeGaps(1440, false)).toEqual({ left: 22.5, right: 22.5 });
  });

  it.each([1280, 1024, 1920, 390, 768])(
    'splits the spare width evenly at %ipx',
    (width) => {
      const { left, right } = edgeGaps(width, width <= 767.98);
      expect(left).toBeCloseTo(right);
    }
  );
});
