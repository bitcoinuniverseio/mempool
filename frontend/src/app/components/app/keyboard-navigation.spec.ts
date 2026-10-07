// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';

describe('global block keyboard navigation', () => {
  it('leaves focused controls, editable descendants and scroll regions to their own keyboard handlers', () => {
    const c = Object.create(AppComponent.prototype);
    c.stateService = { keyNavigation$: { next: vi.fn() } };
    for (const html of ['<select></select>', '<button></button>', '<a href="/">link</a>', '<div contenteditable="true"><span></span></div>', '<div tabindex="0" role="region"></div>', '<textarea></textarea>']) {
      const holder = document.createElement('div'); holder.innerHTML = html;
      const event = { target: holder.querySelector('span') || holder.firstElementChild, code: 'ArrowRight', preventDefault: vi.fn() };
      c.handleKeyboardEvents(event as unknown as KeyboardEvent);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(c.stateService.keyNavigation$.next).not.toHaveBeenCalled();
  });
  it('retains block navigation outside an interactive region', () => {
    const c = Object.create(AppComponent.prototype);
    c.stateService = { keyNavigation$: { next: vi.fn() } };
    const event = { target: document.createElement('div'), code: 'ArrowLeft', preventDefault: vi.fn() };
    c.handleKeyboardEvents(event as unknown as KeyboardEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(c.stateService.keyNavigation$.next).toHaveBeenCalledWith(event);
  });
});
