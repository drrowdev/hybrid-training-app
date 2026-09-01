type RpcError = {
  code?: string;
};

/** The app can retain a pre-migration path only while an additive RPC is absent. */
export function isMissingRpc(error: RpcError | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}
