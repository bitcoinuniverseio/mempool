import { describe, expect, it } from 'vitest';
import { SearchFormComponent } from '@components/search-form/search-form.component';

/**
 * The clear control on the search field.
 *
 * Replacing a 64-character identifier on a phone otherwise means selecting all
 * of one by dragging inside a single-line field, which is a gesture with no
 * keyboard equivalent and a poor success rate with a thumb. So the field gets a
 * full-size clear target, and clearing hands focus straight back, because
 * clearing is almost always the first half of typing or pasting something else.
 *
 * Two things are worth pinning down. The button's presence is read from the
 * control rather than mirrored into a field, so a value arriving from anywhere
 * other than a keystroke cannot leave it showing over an empty field. And focus
 * returns, because losing the keyboard between clearing and typing turns one
 * action into two.
 */

type FakeControl = { value: string };

function component(initial: string): {
  c: SearchFormComponent;
  focused: () => number;
  value: () => string;
} {
  const control: FakeControl = { value: initial };
  let focused = 0;
  const c = Object.create(SearchFormComponent.prototype) as SearchFormComponent;
  (c as unknown as { searchForm: unknown }).searchForm = {
    get: (name: string): FakeControl | null => (name === 'searchText' ? control : null),
    setValue: (v: { searchText: string }): void => { control.value = v.searchText; },
  };
  (c as unknown as { searchInput: unknown }).searchInput = {
    nativeElement: { focus: (): void => void focused++ },
  };
  return { c, focused: () => focused, value: () => control.value };
}

describe('clearing the search field', () => {
  it('offers the control only when there is something to clear', () => {
    expect(component('').c.hasSearchText).toBe(false);
    expect(component('bc1qexample').c.hasSearchText).toBe(true);
  });

  it('empties the field and hands focus back', () => {
    const { c, focused, value } = component('a'.repeat(64));

    c.clearSearch();

    expect(value()).toBe('');
    expect(focused()).toBe(1);
  });

  it('stops offering itself once the field is empty', () => {
    const { c } = component('000000000019d6689c085ae165831e93');

    c.clearSearch();

    // Read from the control, so the successful-search reset that empties the
    // same control also takes the button away. A mirrored boolean would have
    // left it hanging over an empty field.
    expect(c.hasSearchText).toBe(false);
  });

  it('treats a field it cannot find as empty rather than throwing', () => {
    const c = Object.create(SearchFormComponent.prototype) as SearchFormComponent;
    (c as unknown as { searchForm: unknown }).searchForm = undefined;

    // The getter runs on every change detection pass, including ones before the
    // form group is built.
    expect(c.hasSearchText).toBe(false);
  });
});
