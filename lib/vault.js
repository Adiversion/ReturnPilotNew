// ═══════════════════════════════════════════════════════════════
//  ReturnPilot v4.0 — Credential Vault
//  © 2026 KasyHQ. All Rights Reserved.
// ═══════════════════════════════════════════════════════════════
// Encrypts saved GST passwords at rest (AES-256-GCM). The encryption key
// lives in chrome.storage.local so saved passwords stay decryptable across
// browser restarts (the Quick-Login selector must be able to restore the
// password every time the popup opens). Keys from older builds that stored
// them in chrome.storage.session are migrated automatically on first use.
//
// Legacy plaintext values are passed through on read (existing installs keep
// working); they are re-encrypted on the next save.
//
// Loaded as a classic script in the popup (ReturnPilot.html) and imported for
// side effects in the background service worker (background.js).
(function (root) {
  'use strict';

  var PREFIX = 'rpv1:';

  function bytesToBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var keyPromise = null;
  function getKeyBytes() {
    if (!keyPromise) {
      keyPromise = (async function () {
        try {
          // 1. Persistent key (survives browser restarts) — primary store.
          var stored = await chrome.storage.local.get('rp_vault_key');
          if (stored && stored.rp_vault_key) return base64ToBytes(stored.rp_vault_key);

          // 2. Legacy migration: older builds kept the key in session storage.
          //    Copy it into local storage so already-saved passwords keep
          //    decrypting, then remove the session copy.
          var legacy = await chrome.storage.session.get('rp_vault_key');
          if (legacy && legacy.rp_vault_key) {
            await chrome.storage.local.set({ rp_vault_key: legacy.rp_vault_key });
            await chrome.storage.session.remove('rp_vault_key').catch(function () {});
            return base64ToBytes(legacy.rp_vault_key);
          }

          // 3. Fresh key on first run.
          var key = crypto.getRandomValues(new Uint8Array(32));
          var keyB64 = bytesToBase64(key);
          await chrome.storage.local.set({ rp_vault_key: keyB64 });
          // Guard against a first-run race: if another context (popup vs
          // service worker) generated a different key at the same moment,
          // adopt whatever is actually stored so both sides stay consistent.
          var after = await chrome.storage.local.get('rp_vault_key');
          if (after && after.rp_vault_key && after.rp_vault_key !== keyB64) {
            return base64ToBytes(after.rp_vault_key);
          }
          return key;
        } catch (err) {
          keyPromise = null;
          throw err;
        }
      })();
    }
    return keyPromise;
  }

  function importKey(usage) {
    return getKeyBytes().then(function (keyBytes) {
      return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [usage]);
    });
  }

  async function encrypt(plaintext) {
    var value = plaintext == null ? '' : String(plaintext);
    var key = await importKey('encrypt');
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(value));
    return PREFIX + bytesToBase64(iv) + ':' + bytesToBase64(new Uint8Array(ct));
  }

  async function decrypt(payload) {
    if (typeof payload !== 'string' || payload.indexOf(PREFIX) !== 0) return payload; // legacy plaintext passthrough
    try {
      var body = payload.slice(PREFIX.length);
      var sep = body.indexOf(':');
      if (sep <= 0) return null;
      var key = await importKey('decrypt');
      var iv = base64ToBytes(body.slice(0, sep));
      var ct = base64ToBytes(body.slice(sep + 1));
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      return new TextDecoder().decode(pt);
    } catch (err) {
      return null; // key unavailable or corrupted payload
    }
  }

  function isEncrypted(value) {
    return typeof value === 'string' && value.indexOf(PREFIX) === 0;
  }

  root.ReturnPilotVault = {
    encrypt: encrypt,
    decrypt: decrypt,
    isEncrypted: isEncrypted,
    PREFIX: PREFIX
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
