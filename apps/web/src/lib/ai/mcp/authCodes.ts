/**
 * Shared mint/verify helpers for the short-lived authorization-code
 * envelope and the consent-screen state envelope. Both use the same
 * `MCP_TOKEN_SIGNING_KEY` HMAC the bearer-token layer uses (see
 * `./auth.ts`).
 *
 * Two envelopes, same shape `<base64url(json)>.<base64url(hmac)>`:
 *
 *   AuthCode  — issued by /mcp/authorize/confirm, exchanged at /mcp/token
 *               for a bearer token. Binds {userId, clientId, scope,
 *               redirectUri, iat, exp}. 5-minute lifetime.
 *
 *   ConsentState — issued by GET /mcp/authorize, posted back by the
 *               consent form to /mcp/authorize/confirm. Binds {userId,
 *               clientId, scope, redirectUri, state, nonce, exp}. Acts
 *               as the CSRF token (the signature pins the userId, so a
 *               cross-user forgery cannot validate). 5-minute lifetime.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { requireSigningKey } from "./auth";

export const MCP_AUTH_CODE_LIFETIME_SECONDS = 5 * 60;
export const MCP_CONSENT_STATE_LIFETIME_SECONDS = 5 * 60;

export type AuthCodePayload = {
  userId: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  iat: number;
  exp: number;
};

export type ConsentStatePayload = {
  userId: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  /** Echoed OAuth `state` from the original /authorize request. */
  state: string;
  /** Per-issuance random nonce so two consent renders never collide. */
  nonce: string;
  iat: number;
  exp: number;
};

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

function verifySig(body: string, sig: string, key: string): boolean {
  const expected = sign(body, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function encodeEnvelope(payload: object, key: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

function decodeEnvelope<T>(envelope: string, key: string): T | null {
  const dot = envelope.indexOf(".");
  if (dot <= 0 || dot === envelope.length - 1) return null;
  const body = envelope.slice(0, dot);
  const sig = envelope.slice(dot + 1);
  if (!verifySig(body, sig, key)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as T;
  } catch {
    return null;
  }
}

export function signAuthCode(input: {
  userId: string;
  clientId: string;
  scope: string;
  redirectUri: string;
}): string {
  const key = requireSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthCodePayload = {
    ...input,
    iat: now,
    exp: now + MCP_AUTH_CODE_LIFETIME_SECONDS,
  };
  return encodeEnvelope(payload, key);
}

export function verifyAuthCode(code: string): AuthCodePayload | null {
  const key = requireSigningKey();
  const parsed = decodeEnvelope<AuthCodePayload>(code, key);
  if (!parsed) return null;
  if (Math.floor(Date.now() / 1000) >= parsed.exp) return null;
  return parsed;
}

export function signConsentState(input: {
  userId: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  state: string;
}): string {
  const key = requireSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const payload: ConsentStatePayload = {
    ...input,
    nonce: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + MCP_CONSENT_STATE_LIFETIME_SECONDS,
  };
  return encodeEnvelope(payload, key);
}

export function verifyConsentState(
  token: string,
): ConsentStatePayload | null {
  const key = requireSigningKey();
  const parsed = decodeEnvelope<ConsentStatePayload>(token, key);
  if (!parsed) return null;
  if (Math.floor(Date.now() / 1000) >= parsed.exp) return null;
  return parsed;
}
