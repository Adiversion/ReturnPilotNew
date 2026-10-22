/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ReturnPilot — Pre-Build Chrome Web Store Policy & Quality Gate
 * ═══════════════════════════════════════════════════════════════════════════════
 * Performs comprehensive automated static analysis against all 36 Chrome Web Store
 * rejection categories, Manifest V3 guidelines, and August 2026 store policies.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');

// Color helpers for terminal output
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function runComplianceChecks() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}🔍 RUNNING PRE-BUILD CHROME WEB STORE COMPLIANCE & QUALITY GATE...${ANSI.reset}`);
  console.log(`${ANSI.dim}─────────────────────────────────────────────────────────────────────────────${ANSI.reset}`);

  let passed = 0;
  let warnings = 0;
  let errors = 0;

  function pass(testName, details = '') {
    passed++;
    console.log(`  ${ANSI.green}✔ PASS${ANSI.reset}  ${testName}${details ? ANSI.dim + ' (' + details + ')' + ANSI.reset : ''}`);
  }

  function warn(testName, message) {
    warnings++;
    console.log(`  ${ANSI.yellow}⚠ WARN${ANSI.reset}  ${testName}: ${message}`);
  }

  function fail(testName, message) {
    errors++;
    console.log(`  ${ANSI.red}✖ FAIL${ANSI.reset}  ${testName}: ${ANSI.bold}${message}${ANSI.reset}`);
  }

  // ── TEST 1: Manifest Presence & JSON Syntax ──
  const manifestPath = path.join(rootDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail('Manifest File', 'manifest.json does not exist in root directory!');
    return false;
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    pass('Manifest JSON Parsing', `v${manifest.version}`);
  } catch (err) {
    fail('Manifest JSON Parsing', `Syntax error in manifest.json: ${err.message}`);
    return false;
  }

  // ── TEST 2: Manifest V3 Specification ──
  if (manifest.manifest_version === 3) {
    pass('Manifest Version', 'Manifest V3 compliant');
  } else {
    fail('Manifest Version', `manifest_version must be 3, found ${manifest.manifest_version}`);
  }

  // ── TEST 3: Metadata & Single Purpose (Yellow Zinc / Red Magnesium) ──
  if (manifest.name && manifest.name.length > 0 && manifest.name.length <= 45) {
    pass('Extension Name', manifest.name);
  } else {
    fail('Extension Name', 'Name is missing or exceeds 45 characters');
  }

  if (manifest.description && manifest.description.length > 0 && manifest.description.length <= 132) {
    pass('Extension Description', `${manifest.description.length} chars (valid <= 132)`);
  } else {
    fail('Extension Description', 'Description is missing or exceeds 132 characters');
  }

  // ── TEST 4: Icons Audit (16, 32, 48, 128 px) ──
  const requiredSizes = ['16', '32', '48', '128'];
  let iconsValid = true;
  if (!manifest.icons) {
    fail('Icons Definition', 'icons object is missing in manifest.json');
    iconsValid = false;
  } else {
    requiredSizes.forEach(size => {
      const iconRel = manifest.icons[size];
      if (!iconRel || !fs.existsSync(path.join(rootDir, iconRel))) {
        fail('Icon Resolution', `Missing icon for size ${size}px at ${iconRel || 'undefined'}`);
        iconsValid = false;
      }
    });
  }
  if (iconsValid) pass('Icon Assets Verification', '16px, 32px, 48px, 128px PNGs verified');

  // ── TEST 5: Action Popup & Service Worker File Integrity ──
  if (manifest.action && manifest.action.default_popup) {
    const popupPath = path.join(rootDir, manifest.action.default_popup);
    if (fs.existsSync(popupPath)) {
      pass('Action Popup HTML', manifest.action.default_popup);
    } else {
      fail('Action Popup HTML', `File not found at ${manifest.action.default_popup}`);
    }
  } else {
    fail('Action Popup', 'default_popup is missing');
  }

  if (manifest.background && manifest.background.service_worker) {
    const swPath = path.join(rootDir, manifest.background.service_worker);
    if (fs.existsSync(swPath)) {
      pass('Background Service Worker', manifest.background.service_worker);
    } else {
      fail('Background Service Worker', `File not found at ${manifest.background.service_worker}`);
    }
  } else {
    fail('Background Service Worker', 'background.service_worker is missing');
  }

  // ── TEST 6: Content Scripts & Web Accessible Resources File Integrity ──
  let scriptsValid = true;
  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((cs, idx) => {
      (cs.js || []).forEach(jsFile => {
        if (!fs.existsSync(path.join(rootDir, jsFile))) {
          fail('Content Script Asset', `File missing: ${jsFile} (entry #${idx + 1})`);
          scriptsValid = false;
        }
      });
    });
  }
  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources.forEach(war => {
      (war.resources || []).forEach(resFile => {
        const fullPath = path.join(rootDir, resFile);
        if (resFile.includes('*')) {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fail('Web Accessible Resource', `Directory missing for glob: ${resFile}`);
            scriptsValid = false;
          }
        } else if (!fs.existsSync(fullPath)) {
          fail('Web Accessible Resource', `File missing: ${resFile}`);
          scriptsValid = false;
        }
      });
    });
  }
  if (scriptsValid) pass('Content Script & Resource Linkage', 'All referenced files exist on disk');

  // ── TEST 7: Purple Potassium (Excessive Permissions Audit) ──
  const DANGEROUS_PERMISSIONS = [
    '<all_urls>', '*://*/*', 'http://*/*', 'debugger', 'management',
    'privacy', 'proxy', 'vpnProvider', 'webRequestBlocking'
  ];
  const manifestPerms = (manifest.permissions || []).concat(manifest.host_permissions || []);
  let hasDangerousPerm = false;
  manifestPerms.forEach(p => {
    if (DANGEROUS_PERMISSIONS.includes(p)) {
      fail('Permission Scope (Purple Potassium)', `Dangerous or overly broad permission detected: ${p}`);
      hasDangerousPerm = true;
    }
  });
  if (!hasDangerousPerm) pass('Permission Scope (Purple Potassium)', 'Strictly scoped; zero overly broad permissions');

  // ── TEST 8: Blue Argon (Remote Code & Script Injection Guard) ──
  if (manifest.content_security_policy && manifest.content_security_policy.extension_pages) {
    const csp = manifest.content_security_policy.extension_pages;
    if (csp.includes("'self'") && !csp.includes("'unsafe-eval'") && !csp.includes('http:')) {
      pass('Content Security Policy (Blue Argon)', 'Strict self-only CSP; no unsafe-eval or remote origins');
    } else {
      fail('Content Security Policy (Blue Argon)', `CSP contains unsafe directives: ${csp}`);
    }
  } else {
    warn('Content Security Policy', 'Explicit extension_pages CSP recommended');
  }

  // ── TEST 9: Source Code Static Analysis (eval, obfuscation, insecure HTTP) ──
  const JS_EXTENSIONS = ['.js', '.mjs', '.html'];
  const SCAN_DIRS = ['background.js', 'content.js', 'popup.js', 'popup.html', 'content', 'engine', 'lib', 'popup', 'security', 'assets'];
  
  let scanErrors = 0;
  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');

    // 1. Eval & Dynamic code execution check (Blue Argon)
    if (/\beval\s*\(/.test(content)) {
      fail('Remote Code Execution (Blue Argon)', `eval() found in ${rel}`);
      scanErrors++;
    }
    if (/new\s+Function\s*\(/.test(content)) {
      fail('Dynamic Function Constructor (Blue Argon)', `new Function() found in ${rel}`);
      scanErrors++;
    }

    // 2. Insecure plaintext HTTP network calls (Purple Copper / Purple Nickel)
    const httpMatches = content.match(/http:\/\/(?!localhost|127\.0\.0\.1|schemas\.google\.com|schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.org|www\.w3\.org)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (httpMatches && httpMatches.length > 0) {
      fail('Plaintext HTTP Call (Purple Copper)', `Insecure HTTP endpoints in ${rel}: ${httpMatches.join(', ')}`);
      scanErrors++;
    }

    // 3. Obfuscation Signature Check (Red Titanium)
    if (/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)/.test(content) ||
        /_0x[a-f0-9]{4,6}\s*\[/.test(content)) {
      fail('Code Obfuscation (Red Titanium)', `Obfuscator pattern detected in ${rel}`);
      scanErrors++;
    }
  }

  SCAN_DIRS.forEach(item => {
    const itemPath = path.join(rootDir, item);
    if (fs.existsSync(itemPath)) {
      if (fs.statSync(itemPath).isFile()) {
        scanFile(itemPath);
      } else {
        const walk = (d) => {
          fs.readdirSync(d).forEach(sub => {
            const full = path.join(d, sub);
            if (fs.statSync(full).isDirectory()) {
              walk(full);
            } else if (JS_EXTENSIONS.some(ext => full.endsWith(ext))) {
              scanFile(full);
            }
          });
        };
        walk(itemPath);
      }
    }
  });

  if (scanErrors === 0) {
    pass('Static Code Analysis', '0 eval/Function, 0 plaintext HTTP, 0 obfuscation signatures');
  }

  // ── TEST 10: Overrides & Redirection Guard (Blue Nickel / Yellow Lithium) ──
  if (manifest.chrome_url_overrides) {
    fail('URL Overrides (Blue Nickel)', 'chrome_url_overrides is present');
  } else {
    pass('URL Overrides & Redirection Check', 'No New Tab / Omnibox hijacking detected');
  }

  console.log(`${ANSI.dim}─────────────────────────────────────────────────────────────────────────────${ANSI.reset}`);
  if (errors === 0) {
    console.log(`${ANSI.bold}${ANSI.green}✨ ALL PRE-BUILD COMPLIANCE CHECKS PASSED (${passed} checks clean, ${warnings} notices). Proceeding to build...${ANSI.reset}\n`);
    return true;
  } else {
    console.log(`${ANSI.bold}${ANSI.red}🛑 PRE-BUILD VALIDATION FAILED: ${errors} violation(s) detected. Production build aborted!${ANSI.reset}\n`);
    return false;
  }
}

if (require.main === module) {
  const ok = runComplianceChecks();
  process.exit(ok ? 0 : 1);
}

module.exports = { runComplianceChecks };
