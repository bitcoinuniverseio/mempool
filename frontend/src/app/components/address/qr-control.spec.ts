// @vitest-environment jsdom
import 'zone.js';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AddressComponent } from './address.component';

// Render the actual page control bindings; QR drawing remains a separate renderer.
const html = readFileSync('src/app/components/address/address.component.html', 'utf8');
const control = html.slice(html.indexOf('<span class="qr-control"'), html.indexOf('</span>', html.indexOf('<span class="qr-control"')) + 7)
  .replace(/<fa-icon[\s\S]*?<\/fa-icon>/, '')
  .replace(/<app-qrcode[\s\S]*?<\/app-qrcode>/, '<canvas width="200" height="200"></canvas>');
@Component({ standalone: true, template: control })
class RenderedQrControl {
  addressString = 'accepted-address';
  showQR = false;
  resetQr = AddressComponent.prototype.resetQr;
  toggleQr = AddressComponent.prototype.toggleQr;
  get qrButtonLabel(): string { return Object.getOwnPropertyDescriptor(AddressComponent.prototype, 'qrButtonLabel')!.get!.call(this); }
}
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
describe('address QR explicit activation', () => {
  it('does not borrow hover/focus state before first mouse/touch click or close on leave/blur', () => {
    const fixture = TestBed.createComponent(RenderedQrControl); fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const wrapper = host.querySelector('.qr-control')!;
    const button = host.querySelector('button')!;
    const qr = host.querySelector<HTMLElement>('#address-qr-code')!;
    for (const pointerType of ['mouse', 'touch']) {
      fixture.componentInstance.resetQr(); fixture.detectChanges();
      wrapper.dispatchEvent(new MouseEvent('mouseenter'));
      button.dispatchEvent(new Event('pointerenter'));
      button.focus(); button.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); fixture.detectChanges();
      expect(qr.hidden, pointerType).toBe(true);
      expect(button.getAttribute('aria-label')).toBe('Show address QR code');
      button.click(); fixture.detectChanges();
      expect(qr.hidden, pointerType).toBe(false); expect(button.getAttribute('aria-expanded')).toBe('true');
      wrapper.dispatchEvent(new MouseEvent('mouseleave'));
      button.blur(); button.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); fixture.detectChanges();
      expect(qr.hidden, pointerType).toBe(false);
      expect(button.getAttribute('aria-label')).toBe('Hide address QR code');
      button.click(); fixture.detectChanges(); expect(qr.hidden).toBe(true);
    }
  });
  it('keeps native keyboard button activation toggleable and clears a prior address on reset', () => {
    const fixture = TestBed.createComponent(RenderedQrControl); fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    const qr: HTMLElement = fixture.nativeElement.querySelector('#address-qr-code');
    button.focus(); fixture.detectChanges(); expect(qr.hidden).toBe(true);
    expect(button.type).toBe('button'); expect(button.tabIndex).toBe(0);
    // jsdom does not synthesize native Enter/Space clicks; dispatch their resulting
    // click events. Real keyboard behavior will be checked against the new bundle.
    for (const key of ['Enter', ' ']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      button.click(); button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); fixture.detectChanges();
      expect(qr.hidden).toBe(key === ' ');
    }
    button.click(); fixture.detectChanges(); expect(qr.hidden).toBe(false);
    fixture.componentInstance.resetQr(); fixture.detectChanges(); expect(qr.hidden).toBe(true);
  });
});
