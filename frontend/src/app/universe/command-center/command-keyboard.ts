/**
 * Where the selection goes when a key is pressed.
 *
 * The list navigation is a pure function so the palette's keyboard behaviour
 * is testable without a DOM and identical everywhere it is used: arrows move
 * one row, Home and End jump, and typing resets to no selection rather than
 * holding a stale index into a shorter list.
 */

export type ListKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'other';

/** The next selected index, or null for "no selection". */
export function nextIndex(key: ListKey, current: number | null, count: number): number | null {
  if (count <= 0) { return null; }
  switch (key) {
    case 'ArrowDown':
      if (current === null) { return 0; }
      return Math.min(current + 1, count - 1);
    case 'ArrowUp':
      if (current === null) { return count - 1; }
      return Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Whether the global open shortcut should fire.
 *
 * `/` opens only when the visitor is not already typing somewhere: a slash
 * inside a form field belongs to the form. The explicit combination is
 * always allowed, which is what makes the palette reachable without a
 * pointer and without guessing about focus.
 */
export function shouldOpen(key: string, modifier: boolean, targetIsEditable: boolean): boolean {
  if (modifier && (key === 'k' || key === 'K')) { return true; }
  return key === '/' && !targetIsEditable;
}

/** True for elements whose keystrokes belong to the field, not the page. */
export function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) { return false; }
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') { return true; }
  return element.isContentEditable === true;
}
