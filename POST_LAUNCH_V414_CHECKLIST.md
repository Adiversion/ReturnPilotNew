# ReturnPilot v4.1.4 Post-Launch Playbook & Production Lockdown

This guide outlines the exact checklist and steps to execute across **Chrome Web Store**, **Cloudflare Pages (`kasyhq.com`)**, and **Vercel AI Solver (`StreamlitCa`)** once ReturnPilot v4.1.4 goes live.

---

## 📅 Deployment Phases Overview

```
[Phase 1: Day 0] ──▶ [Phase 2: 24–48h Grace] ──▶ [Phase 3: Day 3 Hard Lockdown]
CWS Publishes v4.1.4      Users Auto-Update            Cut Legacy Backdoor in Vercel
Cloudflare & Vercel Env   Monitor 403 Lead Logs        100% Server-Authoritative
```

---

## 🚀 Phase 1: Day 0 (Immediate Actions Upon CWS Publication)

As soon as Google marks v4.1.4 **"Published"** in the Chrome Web Store Developer Dashboard:

### 1.1 Verify Cloudflare Pages Backend (`kasyhq.com`)
1. **Environment Variables**:
   - Open Cloudflare Pages Dashboard ➔ `kasyhq` project ➔ **Settings** ➔ **Environment variables**.
   - Ensure `ADMIN_SECRET_KEY` is configured in **Production** (matches the secret shared with Vercel).
2. **Verify Edge Caching & Seal Generation**:
   - Run in terminal:
     ```powershell
     curl -i "https://kasyhq.com/api/subscription?email=syedmd35@gmail.com"
     ```
   - Verify that the response returns:
     - HTTP `200 OK`
     - A 64-character `"seal"` in the JSON payload
     - Header `Cache-Control: public, max-age=86400, s-maxage=86400`
   - Repeat the curl command immediately:
     - Verify header `X-Subscription-Source: cloudflare_edge_cache` (served from Cloudflare Edge memory without touching Firestore).

### 1.2 Verify Website Updates & Changelog (`kasyhq.com`)
1. Ensure `kasyhq.com/updates` shows v4.1.4 with key improvements:
   - Statutory GSTR-1 Excel dropdown mapping (`Regular B2B`, `SEZWP`, `SEZWOP`, `Deemed Exp`).
   - Party name resolution fallback (`tradeNam: "NA"` ➔ `lgnm`).
   - 1-Click Fast Sync post-payment licensing.

### 1.3 Verify Vercel Solver Status (`verify.kasyhq.com`)
1. **Environment Variables**:
   - Open Vercel Dashboard ➔ `StreamlitCa` project ➔ **Settings** ➔ **Environment Variables**.
   - Ensure `ADMIN_SECRET_KEY` is set to the exact same value as Cloudflare.
2. **Health Check**:
   ```powershell
   curl "https://verify.kasyhq.com/health"
   ```
   Should return `{"status":"ok"}`.

---

## ⏳ Phase 2: 24–48 Hours Grace Period (Passive Monitoring)

Chrome auto-updates extensions silently in the background. Within 24–48 hours, **90%+ of active users** will automatically be upgraded from v4.1.3 to v4.1.4.

### 2.1 Monitor Vercel Runtime Logs for Sales Leads
Open Vercel Dashboard ➔ **Runtime Logs**:
- Filter by: `[AUTH 403 REJECT]`
- You will see structured entries such as:
  ```text
  [AUTH 403 REJECT] /solve | User: 'user@example.com' | Reason: Active subscription required | Plan: TRIAL | IP: 152.58.x.x
  ```
- **Actionable Insight**: These email addresses belong to users actively attempting to use ReturnPilot whose 7-day trials have expired. Export or record these emails for conversion email sequences or targeted offers.

### 2.2 Monitor Solver Throughput
- Filter by: `[SOLVE 200 OK]`
- Confirm paying users solve in ~20–60ms on the Fast-Path without hitting rate limits.

---

## 🔒 Phase 3: Day 3 Hard Lockdown (Severing Legacy Backdoors)

Once the 48-hour migration window has elapsed, permanently sever support for legacy client-signed keys. After this step, **only server-signed seals produced with `ADMIN_SECRET_KEY` will be accepted.** Any hacked or unpacked extensions running older versions cannot solve CAPTCHAs.

### 3.1 Hard Lockdown in Vercel (`D:\StreamlitCa\api\index.py`)

Open `D:\StreamlitCa\api\index.py`.

#### Change A: Restrict `VALID_SECRETS` to Server Secret Only
Locate line 54 in `api/index.py`:
```python
# Legacy:
VALID_SECRETS = [s for s in [ADMIN_HMAC_SECRET, HMAC_SECRET] if s]
```
Change to:
```python
# Lockdown: Accept ONLY server-side ADMIN_HMAC_SECRET
VALID_SECRETS = [ADMIN_HMAC_SECRET] if ADMIN_HMAC_SECRET else [HMAC_SECRET]
```

#### Change B: Remove Section 3 (Legacy `ts + sig` fallback)
In `_verify_gateway_auth`, remove or disable lines 183–210 (the older v4.1.0–v4.1.3 signature verification block) so that all incoming solve requests MUST present a server seal.

### 3.2 Commit and Deploy to Vercel
```powershell
cd D:\StreamlitCa
git add api/index.py
git commit -m "feat(security): complete post-v4.1.4 hard lockdown, enforce ADMIN_SECRET_KEY seals only"
git push origin main
```

---

## 🧪 Post-Lockdown Verification Test Suite

Run these automated terminal tests to verify that the security perimeter is 100% airtight:

### Test 1: Forged Seal from Unpacked Extension CRX (MUST BE 403 FORBIDDEN)
```powershell
node -e "
const https = require('https');
const crypto = require('crypto');
const legacyKey = 'KASYHQ_SUBSCRIPTION_HMAC_SECRET_2026';
const email = 'hacker_audit@example.com';
const forgedSeal = crypto.createHmac('sha256', legacyKey).update(email + ':PREMIUM:2030-01-01T00:00:00.000Z').digest('hex');
const payload = JSON.stringify({ image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', email, plan: 'PREMIUM', expiresAt: '2030-01-01T00:00:00.000Z', seal: forgedSeal });
const req = https.request({ hostname: 'verify.kasyhq.com', port: 443, path: '/solve', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
  console.log('TEST 1 (Forged Legacy Seal):', res.statusCode === 403 ? '✔ PASS (403 BLOCKED)' : '✖ FAIL (' + res.statusCode + ')');
});
req.write(payload);
req.end();
"
```

### Test 2: Unauthenticated / Blank Body Request (MUST BE 403 FORBIDDEN)
```powershell
node -e "
const https = require('https');
const payload = JSON.stringify({ image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' });
const req = https.request({ hostname: 'verify.kasyhq.com', port: 443, path: '/solve', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
  console.log('TEST 2 (Unauthenticated):', res.statusCode === 403 ? '✔ PASS (403 BLOCKED)' : '✖ FAIL (' + res.statusCode + ')');
});
req.write(payload);
req.end();
"
```

### Test 3: Full Master Audit Suite in ReturnPilot
```powershell
cd D:\ReturnPilot-GST-Assistant
node tests/run-all-audits.js
```
*Expected: All 6 audit suites pass cleanly (0 failures).*

---

## 📋 Emergency Rollback Plan (If Any Legitimate User Reports Issues)

If a legitimate paying user on an older machine cannot solve captchas:
1. Temporarily add `HMAC_SECRET` back to `VALID_SECRETS` in `D:\StreamlitCa\api\index.py`.
2. Push to `main` (instant deploy on Vercel).
3. The server will fall back to checking Firestore (`_is_user_authorized`) for their email without blocking them.
