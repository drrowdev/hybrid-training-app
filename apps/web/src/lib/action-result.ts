export type ActionFailure = { ok?: never; error: string };
export type ActionResult = { ok: true; error?: never } | ActionFailure;

/** Only deliberately authored messages may cross the server-action boundary. */
export class UserActionError extends Error {}

export async function actionResult<T>(
  run: () => Promise<T>,
  message: string,
): Promise<T | ActionFailure> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UserActionError) return { error: error.message };
    console.error(message, error);
    return { error: message };
  }
}
