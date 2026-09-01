const FALLBACK_PATH = "/app";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isSafeRelativePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !CONTROL_CHARACTERS.test(value)
  );
}

/**
 * Accept only app-relative redirect targets. Each encoded layer is checked so
 * values such as `%2F%2Fevil.example` and `/%255cevil.example` cannot become a
 * protocol-relative or backslash URL after another decode.
 */
export function safeAppRedirectPath(
  value: string | null | undefined,
  fallback = FALLBACK_PATH,
): string {
  if (!value || !isSafeRelativePath(value)) return fallback;

  let decoded = value;
  for (let depth = 0; depth < 4; depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (!isSafeRelativePath(next)) return fallback;
    if (next === decoded) return value;
    decoded = next;
  }

  return decoded.includes("%") ? fallback : value;
}
