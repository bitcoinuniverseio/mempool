import { describe, expect, it } from 'vitest';

import { isEditable, nextIndex, shouldOpen } from './command-keyboard';

describe('nextIndex', () => {
  it('starts from the top when nothing is selected yet', () => {
    expect(nextIndex('ArrowDown', null, 5)).toBe(0);
    expect(nextIndex('ArrowUp', null, 5)).toBe(4);
  });

  it('stops at the ends instead of wrapping without warning', () => {
    expect(nextIndex('ArrowDown', 4, 5)).toBe(4);
    expect(nextIndex('ArrowUp', 0, 5)).toBe(0);
  });

  it('jumps with Home and End', () => {
    expect(nextIndex('Home', 3, 5)).toBe(0);
    expect(nextIndex('End', 3, 5)).toBe(4);
  });

  it('holds no selection for an empty or typed-over list', () => {
    expect(nextIndex('ArrowDown', 2, 0)).toBeNull();
    expect(nextIndex('other', 2, 5)).toBeNull();
  });
});

describe('shouldOpen', () => {
  it('opens on the slash when no field has focus', () => {
    expect(shouldOpen('/', false, false)).toBe(true);
  });

  it('leaves the slash alone inside a field', () => {
    expect(shouldOpen('/', false, true)).toBe(false);
  });

  it('always opens on the explicit combination', () => {
    expect(shouldOpen('k', true, false)).toBe(true);
    expect(shouldOpen('k', true, true)).toBe(true);
    expect(shouldOpen('K', true, false)).toBe(true);
  });

  it('ignores plain letters', () => {
    expect(shouldOpen('q', false, false)).toBe(false);
  });
});

describe('isEditable', () => {
  it('recognizes the form elements', () => {
    expect(isEditable({ tagName: 'INPUT' })).toBe(true);
    expect(isEditable({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditable({ tagName: 'SELECT' })).toBe(true);
    expect(isEditable({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditable({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
