import { ChangeDetectorRef } from '@angular/core';
import {
  shortenIdentifier,
  UniverseIdentifierComponent,
} from '@app/universe/universe-identifier.component';

describe('UniverseIdentifierComponent', () => {
  it('keeps short values intact and preserves both ends of long values', () => {
    expect(shortenIdentifier('short-value')).toBe('short-value');
    expect(shortenIdentifier('0123456789abcdefghijklmnopqrstuvwxyz', 17)).toBe(
      '01234567…stuvwxyz'
    );
  });

  it('copies the complete value rather than its shortened display', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const component = new UniverseIdentifierComponent({
      markForCheck: vi.fn(),
    } as unknown as ChangeDetectorRef);
    component.value = '0123456789abcdefghijklmnopqrstuvwxyz';

    await component.copy();

    expect(writeText).toHaveBeenCalledWith(component.value);
    expect(component.displayed).not.toBe(component.value);
    component.ngOnDestroy();
    vi.unstubAllGlobals();
  });
});
