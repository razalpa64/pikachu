// @vitest-environment jsdom
/**
 * The feedback page, clicked through in a real DOM.
 *
 * Rendering is not the risk here — submitting is. A form that looks right and then
 * silently does nothing when you press the button is the most common way a feedback
 * box fails, and it is invisible to any test that only renders.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import Feedback from '../Feedback';
import { localNotes } from '../../lib/feedback';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo = () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
});

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(StoreProvider, null, createElement(Feedback))));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

function setValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const byText = (re: RegExp) =>
  [...host.querySelectorAll<HTMLElement>('button, a')].find((b) => re.test(b.textContent ?? ''));

describe('leaving a review', () => {
  it('posts it, keeps it, and says thank you', async () => {
    // no Supabase in tests, so the honest answer is "saved on this device"
    expect(host.textContent).toMatch(/Cloud sync is off/i);

    const box = host.querySelector<HTMLTextAreaElement>('#fb-message')!;
    await act(async () => {
      setValue(box, 'Me and my brother played Four in a Row for an hour and the AI never once felt random.');
    });
    const star = host.querySelector<HTMLElement>('button[aria-label="4 stars"]')!;
    await act(async () => { star.click(); });
    expect(star.getAttribute('aria-checked')).toBe('true');

    const submit = byText(/Post the review/i)!;
    expect(submit, 'the submit button is labelled for what it does').toBeTruthy();
    await act(async () => { submit.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(host.textContent).toMatch(/Saved\. Thank you\./);
    const notes = localNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].draft.rating).toBe(4);
    expect(notes[0].draft.message).toMatch(/Four in a Row/);
    expect(notes[0].state, 'nothing pretends to have been uploaded').toBe('queued');
  });

  it('refuses a note that is too short, marks the field, and stores nothing', async () => {
    const box = host.querySelector<HTMLTextAreaElement>('#fb-message')!;
    await act(async () => { setValue(box, 'good'); });
    await act(async () => { byText(/Post the review/i)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(host.textContent).toMatch(/at least 12 characters/i);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(localNotes()).toHaveLength(0);
  });

  it('refuses a review with no stars', async () => {
    const box = host.querySelector<HTMLTextAreaElement>('#fb-message')!;
    await act(async () => { setValue(box, 'A perfectly reasonable sentence about the arcade.'); });
    await act(async () => { byText(/Post the review/i)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(host.textContent).toMatch(/Pick a star rating/i);
    expect(localNotes()).toHaveLength(0);
  });
});

describe('the form is labelled for a screen reader', () => {
  it('every field has an associated label or an aria-label', () => {
    const fields = [...host.querySelectorAll<HTMLElement>('input, textarea, select')];
    expect(fields.length, 'name, contact, message, game').toBeGreaterThanOrEqual(3);
    for (const el of fields) {
      const id = el.getAttribute('id');
      const labelled = (id && host.querySelector(`label[for="${id}"]`)) || el.getAttribute('aria-label');
      expect(labelled, `${el.tagName.toLowerCase()}#${id ?? '(no id)'} is labelled`).toBeTruthy();
    }
  });

  it('the four kinds of note are one labelled radiogroup', () => {
    const groups = [...host.querySelectorAll('[role="radiogroup"]')];
    const kinds = groups.find((g) => g.getAttribute('aria-label') === 'Kind of note');
    expect(kinds, 'the kind picker is a radiogroup').toBeTruthy();
    expect(kinds!.querySelectorAll('[role="radio"]')).toHaveLength(4);
    // exactly one is selected, so the group is a choice rather than a toggle set
    expect(kinds!.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
  });
});

describe('suggesting a game', () => {
  it('does not ask for stars, and labels the button for the idea', async () => {
    const idea = host.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]');
    // the kind chips are a radiogroup: pick "A game idea"
    const chip = [...host.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Kind of note"] [role="radio"]')]
      .find((b) => /A game idea/i.test(b.textContent ?? ''))!;
    expect(chip).toBeTruthy();
    await act(async () => { chip.click(); });

    expect(chip.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent, 'no star widget for an idea').not.toMatch(/How many stars\?/);
    expect(byText(/Send the idea/i), 'the button says what it will do').toBeTruthy();
    expect(idea).toBeTruthy();
  });
});
