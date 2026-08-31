/**
 * Event Timer — display access helpers.
 *
 * Pure cryptographic and validation functions for the display pairing flow.
 * No Supabase dependency — called from server-side API routes only.
 */

/** Six-digit numeric pairing code. */
export type PairingCode = string;

/** How long a pairing code stays valid (ms). */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** How long a display access token stays valid (ms). */
export const ACCESS_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Heartbeat interval (ms). Displays should send a heartbeat this often. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** A display is considered online if heartbeat is within this threshold. */
export const HEARTBEAT_ONLINE_THRESHOLD_MS = 90_000;

/** A display is considered delayed (not offline) within this secondary threshold. */
export const HEARTBEAT_DELAYED_THRESHOLD_MS = 45_000;

export type DisplayStatus = "connected" | "delayed" | "offline" | "never_connected" | "revoked";
export type DisplayType = "speaker" | "stage" | "audience";

export interface DisplayPayloadPermissions {
  timer: boolean;
  segmentTitle: boolean;
  speaker: boolean;
  nextSegment: boolean;
  operatorMessage: boolean;
  privateNotes: boolean;
  cues: boolean;
  audienceLabel: boolean;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = globalThis.btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Derive human-readable display status from heartbeat timestamps. */
export function getDisplayStatus(
  lastHeartbeatAt: string | null,
  revokedAt: string | null,
  nowMs: number = Date.now(),
): DisplayStatus {
  if (revokedAt) return "revoked";
  if (!lastHeartbeatAt) return "never_connected";
  const age = nowMs - new Date(lastHeartbeatAt).getTime();
  if (age <= HEARTBEAT_DELAYED_THRESHOLD_MS) return "connected";
  if (age <= HEARTBEAT_ONLINE_THRESHOLD_MS) return "delayed";
  return "offline";
}

/**
 * Generate a cryptographically random 6-digit numeric pairing code.
 * Uses Web Crypto so it works in both Node.js and edge runtimes.
 */
export function generatePairingCode(): PairingCode {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = buf[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** Generate a cryptographically random access token (URL-safe base64, 32 bytes). */
export function generateAccessToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** SHA-256 hash of a string. Returns hex string. */
export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Verify a raw value against a stored SHA-256 hex hash. */
export async function verifyHash(raw: string, storedHash: string): Promise<boolean> {
  const hash = await sha256Hex(raw);
  if (hash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/** Return which fields are safe to expose to a given display type. */
export function getDisplayPermissions(displayType: DisplayType): DisplayPayloadPermissions {
  switch (displayType) {
    case "speaker":
      return {
        timer: true,
        segmentTitle: true,
        speaker: true,
        nextSegment: false,
        operatorMessage: true,
        privateNotes: false,
        cues: false,
        audienceLabel: false,
      };
    case "stage":
      return {
        timer: true,
        segmentTitle: true,
        speaker: true,
        nextSegment: true,
        operatorMessage: true,
        privateNotes: false,
        cues: true,
        audienceLabel: false,
      };
    case "audience":
      return {
        timer: true,
        segmentTitle: true,
        speaker: false,
        nextSegment: false,
        operatorMessage: false,
        privateNotes: false,
        cues: false,
        audienceLabel: true,
      };
  }
}
