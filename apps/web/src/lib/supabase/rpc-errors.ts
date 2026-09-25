type RpcError = {
  code?: string;
  message?: string;
};

export const RPC_SAVE_RETRY_MESSAGE = "Couldn't save. Try again in a moment.";

/** A supplied name avoids classifying unrelated missing functions as an absent RPC. */
export function isMissingRpc(error: RpcError | null, name?: string): boolean {
  return (error?.code === "PGRST202" || error?.code === "42883") &&
    (name === undefined || error.message?.includes(name) === true);
}
