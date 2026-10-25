/**
 * Room codes, and the many shapes people paste them in.
 *
 * A code is five characters from `[A-Z0-9]` — short enough to read aloud, long
 * enough that guessing one is not worth anyone's afternoon. What arrives in the
 * join field is rarely that clean: it may be lower case, wrapped in a chat
 * message, or be a whole invite link copied from a room screen.
 *
 * Kept in its own module so the parsing can be tested without React, and so the
 * front page and the Play Together screen cannot drift apart on what they accept.
 */
export const CODE_LEN = 5;
export const CODE_RE = /^[A-Z0-9]{5}$/;

/** Pull a code out of whatever was typed or pasted, or `null` if there is none. */
export function extractCode(input: string): string | null {
  const raw = String(input ?? '').trim().toUpperCase();
  if (!raw) return null;
  const fromUrl = /\/ROOM\/([A-Z0-9]{5})(?:[/?#]|$)/.exec(raw)?.[1];
  const candidate = fromUrl ?? raw.replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(candidate) ? candidate : null;
}

/** True when what the visitor has so far *could* become a code — used to keep a
 *  field from reddening while someone is still typing their first character. */
export const isPartialCode = (input: string) => {
  const raw = String(input ?? '').toUpperCase();
  return !raw.trim() || (raw.length <= CODE_LEN && !/[^A-Z0-9]/.test(raw));
};
