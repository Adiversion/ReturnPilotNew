// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.0 — Shared crypto helpers
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════

// Cryptographic helper functions for client-side integrity and tokens.
// Server-authoritative secrets are NEVER bundled into client extension distributions.

export async function signHmac(message, secret = "") {
  if (!secret) return "";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

