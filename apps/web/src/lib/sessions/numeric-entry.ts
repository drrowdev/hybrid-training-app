/**
 * Reading a number out of a text field the user is still typing in.
 *
 * The logger's weight and rep fields are `type="text"` rather than
 * `type="number"`, because a native number input's spinners and locale
 * handling differ across browsers and it cannot be styled into the stepper.
 * That leaves the parsing to us, and the naive version was wrong in a way that
 * made decimals unreachable:
 *
 *   value={someNumber}
 *   onChange={(e) => { const n = Number(e.target.value); if (!isNaN(n)) onSet(n); }}
 *
 * Typing "27." parses to 27, the field re-renders from the number, and the
 * dot the user just typed disappears — so the next keystroke gives "275".
 * Typing "27," does not parse at all, so nothing is committed and the
 * controlled field snaps back, refusing the comma outright. Between them there
 * was no route to 27.5, on a scale that stores half-kilos.
 *
 * The rule here is that the field holds TEXT while it is being edited and the
 * number is derived from it, never the other way around.
 */

/** A comma is the decimal separator across most of Europe. Both are accepted. */
const DECIMAL_GRAMMAR = /^\d*(?:[.,]\d*)?$/;
const INTEGER_GRAMMAR = /^\d*$/;

/**
 * Is this something the user could still be part-way through typing?
 *
 * Deliberately permissive about incompleteness ("", "27.", ",5") and strict
 * about everything else. Keystrokes that fail are DROPPED rather than
 * stripped out of the middle of the text: silently turning "2a7" into "27" is
 * worse than the "a" not appearing.
 */
export function isPartialNumber(text: string, integer = false): boolean {
  return (integer ? INTEGER_GRAMMAR : DECIMAL_GRAMMAR).test(text);
}

/**
 * The number a partially-typed field currently means.
 *
 * An empty or separator-only field means zero, which keeps the committed
 * number honest about what is on screen — there is no state where the field
 * shows one thing and the set logs another. `Number` is not used directly: it
 * also accepts "0x1f", "1e3" and surrounding whitespace, none of which a
 * weight field should quietly take.
 */
export function parsePartialNumber(text: string, integer = false): number | null {
  if (!isPartialNumber(text, integer)) return null;
  const normalized = text.replace(",", ".");
  if (normalized === "" || normalized === ".") return 0;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
