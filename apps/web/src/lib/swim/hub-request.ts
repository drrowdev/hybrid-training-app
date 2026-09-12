export function createRequestGate() {
  let busy = false;
  return async (request: () => Promise<void>, setBusy: (busy: boolean) => void): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      setBusy(true);
      await request();
    } finally {
      busy = false;
      setBusy(false);
    }
  };
}
