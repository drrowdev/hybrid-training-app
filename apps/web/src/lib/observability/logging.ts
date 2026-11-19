/** Source label sent with every Supabase request so gateway logs show who called. */
export const CLIENT_INFO = `hta-web/${
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"
}`;

export const SUPABASE_GLOBAL_OPTIONS = { headers: { "X-Client-Info": CLIENT_INFO } };

/** Database calls slower than this are logged even when they succeed. */
export const SLOW_CALL_MS = 2000;

/** Short id shown to the lifter and written to the log line for the same failure. */
export function failureRef(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** One JSON line per event so Vercel's log search can filter on `event`. */
export function logFailure(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...fields }));
}

export function logSlow(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

/** Runs a database call and logs it when slow. Failures stay with the caller. */
export async function timedCall<T>(
  event: string, fields: Record<string, unknown>, call: () => PromiseLike<T>,
): Promise<{ result: T; durationMs: number }> {
  const started = Date.now();
  const result = await call();
  const durationMs = Date.now() - started;
  if (durationMs >= SLOW_CALL_MS) logSlow(`${event}_slow`, { ...fields, durationMs });
  return { result, durationMs };
}
