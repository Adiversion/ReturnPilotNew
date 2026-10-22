const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

// ── Auto-Sync Version Across Entire Codebase ──
try {
  child_process.execSync(`node "${path.join(__dirname, 'bump-version.js')}"`, { stdio: 'pipe' });
} catch (_) {}

// ── Auto-Sync Side Panel HTML from ReturnPilot.html ──
try {
  child_process.execSync(`node "${path.join(__dirname, 'sync-sidepanel-html.js')}"`, { stdio: 'pipe' });
} catch (_) {}

// Read base manifest
const baseManifestPath = path.join(rootDir, 'manifest.json');
const baseManifest = JSON.parse(fs.readFileSync(baseManifestPath, 'utf8'));
const { runComplianceChecks } = require('./verify-webstore-compliance.js');
const { runPostBuildVerification } = require('./verify-dist.js');

// ── STEP 0: Pre-Build Chrome Web Store Compliance & Quality Gate ──
const isCompliant = runComplianceChecks();
if (!isCompliant) {
  console.error('\n❌ Build aborted: Chrome Web Store compliance checks failed!\n');
  process.exit(1);
}

const version = baseManifest.version || '4.0.4';
console.log(`🚀 Starting Clean ReturnPilot Multi-Browser Production Build (v${version})...`);

// ── Auto-Sync Release Version with kasyhq.com Website ──
const websiteFeedbackPath = path.resolve(rootDir, '../kasyhq.com/src/pages/FeedbackPage.tsx');
if (fs.existsSync(websiteFeedbackPath)) {
  try {
    let content = fs.readFileSync(websiteFeedbackPath, 'utf8');
    if (!content.includes(`"${version}"`)) {
      content = content.replace(/KNOWN_RELEASED_VERSIONS\s*=\s*\[([\s\S]*?)\];/, (match, list) => {
        const trimmed = list.trimEnd();
        const separator = trimmed.endsWith(',') ? '\n      ' : ',\n      ';
        return `KNOWN_RELEASED_VERSIONS = [${trimmed}${separator}"${version}"\n    ];`;
      });
      fs.writeFileSync(websiteFeedbackPath, content, 'utf8');
      console.log(`  ✔ Auto-synced version v${version} to kasyhq.com FeedbackPage`);
    }
  } catch (err) {
    console.warn('  ⚠️ Website version sync note:', err.message);
  }
}

const ACTIVE_DIRECTORIES = ['assets', 'content', 'core', 'engine', 'lib', 'popup', 'scripts', 'security'];
const ROOT_ACTIVE_FILES = ['rules.json', 'background.js', 'LICENSE'];

// Helpers for cross-node compatibility (Node 6+)
function rmDirRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    const entries = fs.readdirSync(dirPath);
    for (let i = 0; i < entries.length; i++) {
      const curPath = path.join(dirPath, entries[i]);
      if (fs.statSync(curPath).isDirectory()) {
        rmDirRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    }
    fs.rmdirSync(dirPath);
  }
}

function mkdirRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    mkdirRecursive(path.dirname(dirPath));
    try {
      fs.mkdirSync(dirPath);
    } catch (_) {}
  }
}


function silenceLogsInProduction(js, src) {
  return js;
}

function stripJsCommentsAndWhitespace(code) {
  let out = '';
  let inString = null;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] || '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += '\n';
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++; // skip /
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (inRegex) {
      out += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === '/') {
        inRegex = false;
      }
      continue;
    }

    // Check string entrance
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      out += ch;
      continue;
    }

    // Check comments entrance
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    // Check Regex literal entrance
    if (ch === '/') {
      const trimmedOut = out.trimEnd();
      const lastChar = trimmedOut[trimmedOut.length - 1];
      const isRegexPreceded = !lastChar || '=(,:;!&|?{}[~+-*%^<>'.includes(lastChar) ||
        /\b(?:return|case|typeof|delete|void|instanceof|in|yield|throw)$/.test(trimmedOut);

      if (isRegexPreceded) {
        inRegex = true;
        out += ch;
        continue;
      }
    }

    out += ch;
  }

  return out
    .replace(/\bdebugger\s*;?/g, '')
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim().length > 0)
    .join('\n');
}

function nativeMinifyJs(code, src) {
  const stripped = stripJsCommentsAndWhitespace(code);
  return silenceLogsInProduction(stripped, src);
}

let terser = null;
try {
  terser = require('terser');
} catch (_) {}

async function minifyJavaScript(code, src) {
  if (src.includes('fflate')) return code;

  if (terser) {
    try {
      const isModule = src.endsWith('background.js') || src.includes('engine/');
      const res = await terser.minify(code, {
        ecma: 2020,
        module: isModule,
        compress: {
          drop_console: true,
          drop_debugger: true,
          dead_code: true,
          unused: true,
          pure_funcs: [
            'rpLog.debug',
            'rpLog.info',
            'rpLog.warn',
            'rpLog.error',
            'rpLog.timing',
            'rpLog.timingChain',
            'rpLog.time',
            'rpLog.timeEnd',
            'logTelemetry'
          ],
          global_defs: {
            __DEV__: false
          },
          passes: 2
        },
        mangle: {
          toplevel: false,
          keep_fnames: true,
          keep_classnames: true
        },
        format: {
          comments: false
        }
      });

      if (res && res.code) {
        return res.code;
      }
    } catch (_) {}
  }

  return nativeMinifyJs(code, src);
}

async function copyFile(src, dest) {
  // EXCLUDE dev-only telemetry logger from production builds
  if (src.endsWith('core' + path.sep + 'logger.js') || src.endsWith('core/logger.js')) {
    return;
  }
  mkdirRecursive(path.dirname(dest));
  if (src.endsWith('.css')) {
    const css = fs.readFileSync(src, 'utf8');
    const minCss = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([\{\}\:\;\,])\s*/g, '$1')
      .replace(/\;}/g, '}')
      .trim();
    fs.writeFileSync(dest, minCss, 'utf8');
  } else if (src.endsWith('.html')) {
    let html = fs.readFileSync(src, 'utf8');
    // Strip dev-only logger script tag so production has 0 dev UI / script references
    html = html.replace(/<script\s+[^>]*src=["'][^"']*logger\.js["'][^>]*><\/script>\s*/gi, '');
    const minHtml = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s+/gm, '')
      .trim();
    fs.writeFileSync(dest, minHtml, 'utf8');
  } else if (src.endsWith('.js') || src.endsWith('.mjs')) {
    let js = fs.readFileSync(src, 'utf8');
    if (src.endsWith('background.js')) {
      // Strip dev-only logger import from Service Worker
      js = js.replace(/import\s+['"][^'"]*logger\.js['"];?\s*/g, '');
    }
    js = await minifyJavaScript(js, src);
    fs.writeFileSync(dest, js, 'utf8');
  } else {
    fs.writeFileSync(dest, fs.readFileSync(src));
  }
}

async function copyDirRecursive(srcDir, destDir) {
  mkdirRecursive(destDir);
  const entries = fs.readdirSync(srcDir);
  for (let i = 0; i < entries.length; i++) {
    const srcPath = path.join(srcDir, entries[i]);
    const destPath = path.join(destDir, entries[i]);
    if (fs.statSync(srcPath).isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

// Auto-discover all files from active extension directories
function discoverActiveFiles() {
  const discovered = [];

  for (let i = 0; i < ROOT_ACTIVE_FILES.length; i++) {
    const file = ROOT_ACTIVE_FILES[i];
    if (fs.existsSync(path.join(rootDir, file))) {
      discovered.push(file);
    }
  }

  for (let i = 0; i < ACTIVE_DIRECTORIES.length; i++) {
    const dir = ACTIVE_DIRECTORIES[i];
    const dirPath = path.join(rootDir, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const walk = function(curDir) {
        const entries = fs.readdirSync(curDir);
        for (let j = 0; j < entries.length; j++) {
          const entryName = entries[j];
          const fullPath = path.join(curDir, entryName);
          const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
          if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
          } else {
            const isDevFile = (relPath.startsWith('scripts/') && relPath !== 'scripts/scripts.js') ||
                              relPath === 'core/logger.js' ||
                              relPath.endsWith('.py') ||
                              relPath.endsWith('.mjs') ||
                              relPath.endsWith('.md') ||
                              entryName.startsWith('.') ||
                              entryName.endsWith('.test.js') ||
                              entryName.endsWith('.spec.js') ||
                              entryName.endsWith('.tmp');
            if (!isDevFile) {
              discovered.push(relPath);
            }
          }
        }
      };
      walk(dirPath);
    }
  }

  return discovered.sort();
}

const REQUIRED_FILES = discoverActiveFiles();

// Target browser configurations
const TARGETS = {
  chrome: {
    name: 'Google Chrome',
    manifestGenerator: (base) => {
      const manifest = JSON.parse(JSON.stringify(base));
      manifest.background = {
        service_worker: 'background.js',
        type: 'module'
      };
      if (manifest.action && manifest.action.browser_style !== undefined) {
        delete manifest.action.browser_style;
      }
      delete manifest.browser_specific_settings;
      delete manifest.update_url;
      delete manifest.sidebar_action;
      return manifest;
    }
  },
  edge: {
    name: 'Microsoft Edge',
    manifestGenerator: (base) => {
      const manifest = JSON.parse(JSON.stringify(base));
      manifest.background = {
        service_worker: 'background.js',
        type: 'module'
      };
      if (manifest.action && manifest.action.browser_style !== undefined) {
        delete manifest.action.browser_style;
      }
      delete manifest.browser_specific_settings;
      delete manifest.update_url;
      delete manifest.sidebar_action;
      return manifest;
    }
  },
  firefox: {
    name: 'Mozilla Firefox',
    manifestGenerator: (base) => {
      const manifest = JSON.parse(JSON.stringify(base));
      manifest.background = {
        scripts: ['background.js'],
        type: 'module'
      };
      manifest.browser_specific_settings = {
        gecko: {
          id: 'returnpilot@kasyhq.com',
          strict_min_version: '115.0',
          data_collection_permissions: {
            required: ['none']
          }
        }
      };
      if (manifest.action && manifest.action.browser_style !== undefined) {
        delete manifest.action.browser_style;
      }
      delete manifest.update_url;
      if (Array.isArray(manifest.permissions)) {
        manifest.permissions = manifest.permissions.filter(p => p !== 'sidePanel');
        if (!manifest.permissions.includes('tabs')) {
          manifest.permissions.push('tabs');
        }
      }
      delete manifest.side_panel;
      manifest.sidebar_action = {
        default_title: 'ReturnPilot — Your GST Copilot',
        default_panel: 'popup/sidepanel.html',
        default_icon: {
          '16': 'assets/icons/icon-16.png',
          '32': 'assets/icons/icon-32.png',
          '48': 'assets/icons/icon-48.png',
          '128': 'assets/icons/icon-128.png'
        }
      };
      return manifest;
    }
  }
};

async function runBuild() {
  // 1. Clean and prepare dist directory
  console.log('🧹 Cleaning dist directory...');
  rmDirRecursive(distDir);
  mkdirRecursive(distDir);

  // 2. Assemble browser distributions
  console.log(`📦 Assembling ${REQUIRED_FILES.length} files across Chrome, Edge, and Firefox...`);

  for (const targetKey of Object.keys(TARGETS)) {
    const targetConfig = TARGETS[targetKey];
    const targetDistDir = path.join(distDir, targetKey);
    mkdirRecursive(targetDistDir);

    for (const relPath of REQUIRED_FILES) {
      const src = path.join(rootDir, relPath);
      const dest = path.join(targetDistDir, relPath);
      if (fs.existsSync(src)) {
        await copyFile(src, dest);
      }
    }

    const targetManifest = targetConfig.manifestGenerator(baseManifest);
    const targetManifestPath = path.join(targetDistDir, 'manifest.json');
    fs.writeFileSync(targetManifestPath, JSON.stringify(targetManifest, null, 2) + '\n', 'utf8');

    console.log(`  ✔ Assembled ${targetConfig.name} in ./dist/${targetKey}`);
  }

  // 3. Package ZIP releases
  console.log('\n📦 Packaging release archives for Chrome, Edge, and Firefox...');

  try {
    const pyCmd = `python "${path.join(rootDir, 'scripts', 'make-zip.py')}"`;
    child_process.execSync(pyCmd, { stdio: 'inherit' });
  } catch (pyErr) {
    console.log('  Notice: Falling back to PowerShell Compress-Archive...');
    for (const targetKey of Object.keys(TARGETS)) {
      const targetDir = path.join(distDir, targetKey);
      if (fs.existsSync(targetDir)) {
        const zipName = `ReturnPilot-v${version}-${targetKey}.zip`;
        const zipRoot = path.join(rootDir, zipName);
        const zipDist = path.join(distDir, zipName);

        try {
          if (fs.existsSync(zipRoot)) fs.unlinkSync(zipRoot);
          if (fs.existsSync(zipDist)) fs.unlinkSync(zipDist);

          const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${targetDir}\\*' -DestinationPath '${zipRoot}' -Force"`;
          child_process.execSync(psCmd, { stdio: 'pipe' });

          if (fs.existsSync(zipRoot)) {
            fs.writeFileSync(zipDist, fs.readFileSync(zipRoot));
            const sizeKb = (fs.statSync(zipRoot).size / 1024).toFixed(1);
            console.log(`  + [${targetKey.toUpperCase()}] ${zipName} (${sizeKb} KB)`);
          }
        } catch (e) {
          console.warn(`  ⚠️ Could not create zip for ${targetKey}: ${e.message}`);
        }
      }
    }

    // Fallback legacy production zip alias
    const chromeZip = path.join(rootDir, `ReturnPilot-v${version}-chrome.zip`);
    const legacyZip = path.join(rootDir, `ReturnPilot-v${version}-production.zip`);
    const legacyDist = path.join(distDir, `ReturnPilot-v${version}-production.zip`);
    if (fs.existsSync(chromeZip)) {
      fs.writeFileSync(legacyZip, fs.readFileSync(chromeZip));
      fs.writeFileSync(legacyDist, fs.readFileSync(chromeZip));
      console.log(`  + [LEGACY] ReturnPilot-v${version}-production.zip (${(fs.statSync(legacyZip).size / 1024).toFixed(1)} KB)`);
    }
  }

  console.log(`\n🎉 Multi-Browser Production Build Ready (v${version})!`);
  console.log(`  • Chrome Web Store:     ReturnPilot-v${version}-chrome.zip (or ./dist/chrome)`);
  console.log(`  • Microsoft Edge Store: ReturnPilot-v${version}-edge.zip   (or ./dist/edge)`);
  console.log(`  • Mozilla Add-ons (AMO): ReturnPilot-v${version}-firefox.zip (or ./dist/firefox)`);

  // 4. Run Post-Build Integrity & Syntax Gate
  const distVerified = runPostBuildVerification();
  if (!distVerified) {
    console.error('\n❌ Build failed post-build integrity check!\n');
    process.exit(1);
  }
}

runBuild().catch(err => {
  console.error('\n❌ Production build failed:', err);
  process.exit(1);
});

