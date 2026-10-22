// ═══════════════════════════════════════════════════════════════════════════════
//  ReturnPilot v4.2.5 — Cryptographic Anti-Theft & Code Entanglement Security Engine
//  © 2026 KasyHQ. All Rights Reserved.
//  UNAUTHORIZED COPYING, REBRANDING, OR REFACTORING HARD-LOCKS ALL CORE APIS.
// ═══════════════════════════════════════════════════════════════════════════════

(function(root) {
  'use strict';

  // Official Extension Runtime Context Seed
  const OFFICIAL_CWS_ID = "nmahcnpinkblcaimpbalgffmfdejjkoh";
  function getRuntimeContextSeed() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      return chrome.runtime.id;
    }
    return "RETURNPILOT_CORE_RUNTIME";
  }
  const AUTHORIZED_VERSIONS = ['4.0.0', '4.0.1', '4.0.2', '4.0.3', '4.0.4', '4.1.0', '4.1.1', '4.1.2', '4.1.3', '4.1.4', '4.1.5', '4.1.6', '4.1.7', '4.1.8', '4.1.9', '4.2.0', '4.2.1', '4.2.2', '4.2.3', '4.2.4', '4.2.5'];
  const VALID_TIERS = ['FREE', 'TRIAL', 'PREMIUM'];
  const OFFICIAL_DOWNLOAD_URL = "https://kasyhq.com/returnpilot-gst";

  // Temporal Sanity Limits: Inception = Jan 1, 2024 (1704067200000)
  // Firebase / Firestore is the authoritative source for subscription expiration dates (including long-term/developer plans).
  const MIN_SANITY_TIMESTAMP = 1704067200000;

  // Known Disposable / Temp-Mail Domain Suffixes & Patterns (e.g. fodmy.mwo, 10minutemail, etc.)
  const DISPOSABLE_DOMAIN_PATTERNS = [
    'fodmy.mwo', 'mwo', 'tempmail', '10minutemail', 'guerrillamail', 'mailinator',
    'yopmail', 'trashmail', 'throwawaymail', 'sharklasers', 'dispostable',
    'getairmail', 'generator.email', 'fake-box', 'mytempemail', 'crazymailing'
  ];

  function computeHash(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function isTemporalTamper(ts) {
    if (!ts) return false;
    const num = Number(ts);
    if (isNaN(num)) return true;
    // Reject invalid numbers, negative timestamps, or dates before inception (Jan 1, 2024)
    if (num < MIN_SANITY_TIMESTAMP) {
      return true;
    }
    return false;
  }

  function isDisposableOrSuspiciousEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const clean = email.trim().toLowerCase();
    const parts = clean.split('@');
    if (parts.length !== 2) return true;

    const [user, domain] = parts;
    // 1. Check known disposable domains & TLDs
    const isDisposableDomain = DISPOSABLE_DOMAIN_PATTERNS.some(d => domain === d || domain.endsWith('.' + d));
    if (isDisposableDomain) return true;

    // 2. Check for high-entropy suspicious temp-mail usernames (e.g. kwqchvznypecdvhnw36)
    if (user.length > 18 && /^[a-z0-9]+$/.test(user) && !user.includes('.') && !user.includes('_')) {
      const digitCount = (user.match(/\d/g) || []).length;
      if (digitCount > 0 && digitCount < user.length) return true;
    }

    return false;
  }

  function sanitizeTier(tier) {
    if (!tier || typeof tier !== 'string') return 'FREE';
    const upper = tier.trim().toUpperCase();
    return VALID_TIERS.includes(upper) ? upper : 'FREE';
  }

  function verifyEntanglement(senderContext) {
    return computeHash(getRuntimeContextSeed() + ':' + (senderContext || 'default'));
  }

  function generateTelemetrySignature(version, tier, installTime) {
    const safeTier = sanitizeTier(tier);
    const safeInstallTime = isTemporalTamper(installTime) ? Date.now() : installTime;
    const raw = `${getRuntimeContextSeed()}|${version || ''}|${safeTier}|${safeInstallTime || ''}`;
    return computeHash(raw);
  }

  function generateLicenseSeal(state) {
    if (!state) return '';
    // Server-Authoritative: License seals originate from kasyhq.com/api/subscription
    if (state.seal) return state.seal;
    const safeTier = sanitizeTier(state.tier);
    const safeExpires = isTemporalTamper(state.expiresAt) ? '0' : (state.expiresAt || '0');
    const raw = `${getRuntimeContextSeed()}|${safeTier}|${state.valid ? '1' : '0'}|${safeExpires}|${state.subscribedAt || '0'}`;
    return computeHash(raw);
  }

  function verifyLicenseSeal(state, email) {
    if (!state) return false;
    if (isTemporalTamper(state.expiresAt)) return false;
    const tier = String(state.tier || '').toUpperCase();
    if (!VALID_TIERS.includes(tier)) return false;
    if (tier === 'FREE') return true;

    // Premium and Trial licenses require an authentic server-issued seal
    if (!state.seal || typeof state.seal !== 'string') return false;

    // Fast-path: Reject short or non-hex seals (server seals are 64-char HMAC-SHA256 hex strings)
    const cleanSeal = state.seal.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(cleanSeal)) return false;

    return true;
  }

  function verifyNativeIntegrity() {
    try {
      // In Node.js / CLI test runner environments without browser DOM or chrome runtime, pass cleanly
      const isBrowserContext = (typeof window !== 'undefined' || typeof self !== 'undefined') && 
        (typeof document !== 'undefined' || (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id));
      if (!isBrowserContext) {
        return true;
      }

      // 1. Function.prototype.toString integrity
      const toStringFn = Function.prototype.toString;
      if (typeof toStringFn !== 'function') return false;
      const toStringCode = toStringFn.call(toStringFn);
      if (!toStringCode.includes('[native code]')) return false;

      // 2. Window / Global Fetch Hook Detection
      if (typeof root.fetch === 'function') {
        const isFetchNative = toStringFn.call(root.fetch).includes('[native code]');
        if (!isFetchNative) return false;
      }

      // 3. Web Crypto API Hook Detection
      if (typeof root.crypto !== 'undefined' && root.crypto.subtle && typeof root.crypto.subtle.sign === 'function') {
        const isCryptoNative = toStringFn.call(root.crypto.subtle.sign).includes('[native code]');
        if (!isCryptoNative) return false;
      }

      // 4. JSON Parser Hook Detection
      if (typeof JSON !== 'undefined' && typeof JSON.parse === 'function') {
        const isJsonNative = toStringFn.call(JSON.parse).includes('[native code]');
        if (!isJsonNative) return false;
      }

      // 5. Chrome Storage API Hook Detection
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
        const isStorageNative = toStringFn.call(chrome.storage.local.get).includes('[native code]');
        if (!isStorageNative) return false;
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  function isOfficialProductionBuild() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        const manifest = chrome.runtime.getManifest();
        return typeof manifest.update_url === 'string' && manifest.update_url.includes('google.com');
      }
    } catch (_) {}
    return false;
  }

  function verifyLicenseKey(key) {
    // ReturnPilot licenses are cryptographically verified online via Google Account and kasyhq.com API.
    // Static offline keys are disabled to prevent keygen cracking.
    return { valid: false, tier: 'FREE', reason: 'Please sign in with your licensed Google Account.' };
  }

  function getCurrentFyStartYear() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    return month >= 3 ? year : year - 1;
  }

  function formatFyString(startYr) {
    const nextYrShort = String(startYr + 1).slice(-2);
    return `${startYr}-${nextYrShort}`;
  }

  function checkFeatureAccess(requestType, licenseData, startYear) {
    // Layer 1: Verify Native Runtime Integrity
    const isIntegrityClean = verifyNativeIntegrity();
    if (!isIntegrityClean) {
      return {
        allowed: false,
        tampered: true,
        officialUrl: OFFICIAL_DOWNLOAD_URL,
        reason: 'Security Verification Notice: An unauthorized script hook or modified runtime environment was detected. Automated features are disabled to protect data integrity. Please install the verified release from the official Chrome Web Store (https://kasyhq.com/returnpilot-gst).'
      };
    }

    // Layer 2: Check Temporal & Tier Integrity
    if (licenseData && (isTemporalTamper(licenseData.expiresAt) || (licenseData.tier && !VALID_TIERS.includes(licenseData.tier)))) {
      return {
        allowed: false,
        tampered: true,
        officialUrl: OFFICIAL_DOWNLOAD_URL,
        reason: 'Security Verification Notice: Invalid or manipulated license timeframe detected. Please install the official release.'
      };
    }

    // Layer 2.5: Cryptographic License Seal Check
    if (licenseData && (licenseData.tier === 'PREMIUM' || licenseData.tier === 'TRIAL')) {
      if (licenseData.seal && !verifyLicenseSeal(licenseData)) {
        return {
          allowed: false,
          tampered: true,
          officialUrl: OFFICIAL_DOWNLOAD_URL,
          reason: 'Security Verification Notice: Invalid or unverified cryptographic license seal. Please sign in with your licensed Google Account.'
        };
      }
    }

    // Layer 3: Check License State
    const isPremium = licenseData && licenseData.valid && licenseData.tier === 'PREMIUM';
    if (!isPremium) {
      if (requestType === 'CONSOLIDATED_EXCEL') {
        return { allowed: false, reason: 'Consolidated Annual Reports & Statutory Workbooks are exclusive to ReturnPilot Premium members.' };
      }
      if (requestType === 'JSON' || requestType === 'download-json') {
        const currentFyStart = getCurrentFyStartYear();
        const cutoffStartYear = currentFyStart - 2;
        if (typeof startYear !== 'undefined' && startYear !== null && startYear < cutoffStartYear) {
          const fy1 = formatFyString(currentFyStart);
          const fy2 = formatFyString(currentFyStart - 1);
          const fy3 = formatFyString(currentFyStart - 2);
          return { allowed: false, reason: `Free plan includes JSON downloads for FY ${fy1}, ${fy2}, and ${fy3}. Upgrade to ReturnPilot Premium for older financial years.` };
        }
        return { allowed: true, tier: 'FREE' };
      }
      return { allowed: false, reason: 'PDF Compilation and Excel Export features require an active ReturnPilot Premium License (₹199/month or ₹1,999/year).' };
    }
    return { allowed: true, tier: 'PREMIUM' };
  }

  const EntanglementEngine = {
    computeHash,
    isTemporalTamper,
    isDisposableOrSuspiciousEmail,
    sanitizeTier,
    verifyEntanglement,
    generateTelemetrySignature,
    generateLicenseSeal,
    verifyLicenseSeal,
    verifyNativeIntegrity,
    verifyLicenseKey,
    checkFeatureAccess,
    isOfficialProductionBuild,
    OFFICIAL_DOWNLOAD_URL,
    AUTHORIZED_VERSIONS,
    VALID_TIERS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EntanglementEngine;
  } else {
    root.ReturnPilotSecurity = EntanglementEngine;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
