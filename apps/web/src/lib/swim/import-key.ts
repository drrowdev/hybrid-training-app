import { createHash, randomBytes } from "node:crypto";

export function makeSwimImportKey(): string {
  return `swim_${randomBytes(32).toString("base64url")}`;
}

export function hashSwimImportKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function swimImportBearer(header: string | null): string | null {
  const match = /^Bearer (swim_[A-Za-z0-9_-]{43})$/.exec(header ?? "");
  return match?.[1] ?? null;
}
