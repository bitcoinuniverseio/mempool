// @vitest-environment jsdom
import 'zone.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressComponent } from './address.component';

describe('address QR activation sequence', () => {
  afterEach(() => vi.unstubAllGlobals());
  function fixture(hover: boolean): AddressComponent {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: hover }) });
    const component = Object.create(AddressComponent.prototype) as AddressComponent;
    component.resetQr(); return component;
  }
  it('keeps a first touch open after pointer-focus followed by click and permits another toggle', () => {
    const component = fixture(false); component.onQrEnter();
    component.onQrFocus({ target: { matches: () => false } } as never);
    component.toggleQr(); expect(component.showQR).toBe(true);
    component.toggleQr(); expect(component.showQR).toBe(false);
  });
  it('preserves mouse hover preview and keyboard focus visibility without borrowing a previous address', () => {
    const component = fixture(true); component.onQrEnter(); expect(component.showQR).toBe(true);
    expect(component.qrButtonLabel).toBe('Hide address QR code'); component.toggleQr(); expect(component.showQR).toBe(false);
    expect(component.qrButtonLabel).toBe('Show address QR code');
    component.onQrLeave(); expect(component.showQR).toBe(false);
    component.onQrFocus({ target: { matches: () => true } } as never); expect(component.showQR).toBe(true);
    component.toggleQr(); expect(component.showQR).toBe(false); component.toggleQr(); expect(component.showQR).toBe(true);
    component.resetQr(); expect(component.showQR).toBe(false);
    component.toggleQr(); expect(component.showQR).toBe(true);
  });
});
