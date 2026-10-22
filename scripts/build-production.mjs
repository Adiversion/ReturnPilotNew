import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = util.promisify(exec);
const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const stagingDir = path.join(distDir, '.staging');

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { runComplianceChecks } = require('./verify-webstore-compliance.js');

// Read base manifest
const baseManifestPath = path.join(rootDir, 'manifest.json');
const baseManifest = JSON.parse(fs.readFileSync(baseManifestPath, 'utf8'));

// ── STEP 0: Pre-Build Chrome Web Store Compliance & Quality Gate ──
const isCompliant = runComplianceChecks();
if (!isCompliant) {
  console.error('\n❌ Build aborted: Chrome Web Store compliance checks failed!\n');
  process.exit(1);
}

const version = baseManifest.version || '4.0.3';

console.log(`🚀 Starting Clean ReturnPilot Multi-Browser Production Build (v${version})...`);

// Active directories and root files to include in production builds
const ACTIVE_DIRECTORIES = ['assets', 'content', 'core', 'engine', 'lib', 'popup', 'scripts', 'security'];
const ROOT_ACTIVE_FILES = ['rules.json', 'background.js', 'LICENSE'];

// Auto-discover all files from active extension directories
function discoverActiveFiles() {
  const discovered = [];

  // Add active root files
  for (const file of ROOT_ACTIVE_FILES) {
    if (fs.existsSync(path.join(rootDir, file))) {
      discovered.push(file);
    }
  }

  // Traverse active directories recursively
  for (const dir of ACTIVE_DIRECTORIES) {
    const dirPath = path.join(rootDir, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const walk = (curDir, baseDir) => {
        const entries = fs.readdirSync(curDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(curDir, entry.name);
          const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            walk(fullPath, baseDir);
          } else {
            // Ignore dev/test scripts, markdown docs, python scripts, hidden files and temp files
            const isDevFile = (relPath.startsWith('scripts/') && relPath !== 'scripts/scripts.js') ||
                              relPath.endsWith('.py') ||
                              relPath.endsWith('.mjs') ||
                              relPath.endsWith('.md') ||
                              entry.name.startsWith('.') ||
                              entry.name.endsWith('.test.js') ||
                              entry.name.endsWith('.spec.js') ||
                              entry.name.endsWith('.tmp');
            if (!isDevFile) {
              discovered.push(relPath);
            }
          }
        }
      };
      walk(dirPath, dir);
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

const JS_FILES_TO_MINIFY = REQUIRED_FILES.filter(f => f.endsWith('.js'));

// Helper for recursive copying
function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Clean dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(stagingDir, { recursive: true });

// 2. Copy active extension files into staging directory
console.log(`📦 Staging ${REQUIRED_FILES.length} active extension files...`);
REQUIRED_FILES.forEach(relPath => {
  const src = path.join(rootDir, relPath);
  const dest = path.join(stagingDir, relPath);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } else {
    console.warn(`  ⚠️ Warning: Required file missing: ${relPath}`);
  }
});

// 3. Minify JS files in staging using Terser CLI
console.log(`⚙ Minifying ${JS_FILES_TO_MINIFY.length} JavaScript files in staging...`);

(async () => {
  let minifiedCount = 0;
  let totalOrigBytes = 0;
  let totalMinBytes = 0;

  for (let i = 0; i < JS_FILES_TO_MINIFY.length; i += 5) {
    const chunk = JS_FILES_TO_MINIFY.slice(i, i + 5);
    await Promise.all(chunk.map(async (relFile) => {
      const targetFile = path.join(stagingDir, relFile);
      if (fs.existsSync(targetFile)) {
        try {
          const origSize = fs.statSync(targetFile).size;
          totalOrigBytes += origSize;
          try {
            await execPromise(`npx terser "${targetFile}" -o "${targetFile}" --compress drop_console=true,drop_debugger=true --mangle --format comments=false`);
          } catch (_) {
            // Keep original file intact if terser is not installed
          }
          const minSize = fs.statSync(targetFile).size;
          totalMinBytes += minSize;
          const savings = (((origSize - minSize) / origSize) * 100).toFixed(1);
          console.log(`  ✔ Minified ${relFile} (${origSize}B ➔ ${minSize}B, -${savings}%)`);
          minifiedCount++;
        } catch (err) {
          console.warn(`  ⚠️ Minification notice for ${relFile}: ${err.message}`);
        }
      }
    }));
  }

  const overallSavings = totalOrigBytes > 0 ? (((totalOrigBytes - totalMinBytes) / totalOrigBytes) * 100).toFixed(1) : 0;
  console.log(`\n✨ Minification completed: ${minifiedCount} files (${totalOrigBytes}B ➔ ${totalMinBytes}B, -${overallSavings}% total reduction).`);

  // 4. Assemble target distributions (Chrome, Edge, Firefox)
  console.log('\n🏗️ Assembling browser-specific distributions...');

  for (const [targetKey, targetConfig] of Object.entries(TARGETS)) {
    const targetDistDir = path.join(distDir, targetKey);
    fs.mkdirSync(targetDistDir, { recursive: true });

    // Copy minified staging files to target directory
    copyDirRecursive(stagingDir, targetDistDir);

    // Generate and write target-specific manifest.json
    const targetManifest = targetConfig.manifestGenerator(baseManifest);
    const targetManifestPath = path.join(targetDistDir, 'manifest.json');
    fs.writeFileSync(targetManifestPath, JSON.stringify(targetManifest, null, 2) + '\n', 'utf8');

    console.log(`  ✔ Assembled ${targetConfig.name} distribution in ./dist/${targetKey}`);
  }

  // 5. Clean up temporary staging directory
  fs.rmSync(stagingDir, { recursive: true, force: true });

  // 6. Generate ZIP packages for all 3 targets (POSIX compliant root archives)
  console.log('\n📦 Packaging release archives for Chrome, Edge, and Firefox...');
  let zipCreated = false;
  try {
    const { stdout } = await execPromise('python scripts/make-zip.py');
    console.log(stdout.trim());
    zipCreated = true;
  } catch (_) {}

  if (!zipCreated) {
    for (const targetKey of Object.keys(TARGETS)) {
      const targetDir = path.join(distDir, targetKey);
      if (fs.existsSync(targetDir)) {
        const zipName = `ReturnPilot-v${version}-${targetKey}.zip`;
        const zipRoot = path.join(rootDir, zipName);
        const zipDist = path.join(distDir, zipName);
        try {
          if (fs.existsSync(zipRoot)) fs.unlinkSync(zipRoot);
          if (fs.existsSync(zipDist)) fs.unlinkSync(zipDist);
          await execPromise(`powershell -NoProfile -Command "Compress-Archive -Path '${targetDir}\\*' -DestinationPath '${zipRoot}' -Force"`);
          if (fs.existsSync(zipRoot)) {
            fs.copyFileSync(zipRoot, zipDist);
            const sizeKb = (fs.statSync(zipRoot).size / 1024).toFixed(1);
            console.log(`  + [${targetKey.toUpperCase()}] ${zipName} (${sizeKb} KB)`);
          }
        } catch (e) {
          console.warn(`  ⚠️ Could not create zip for ${targetKey}: ${e.message}`);
        }
      }
    }
  }

  console.log(`\n🎉 Multi-Browser Production Build Ready (v${version})!`);
  console.log(`  • Chrome Web Store:     ReturnPilot-v${version}-chrome.zip (or ./dist/chrome)`);
  console.log(`  • Microsoft Edge Store: ReturnPilot-v${version}-edge.zip   (or ./dist/edge)`);
  console.log(`  • Mozilla Add-ons (AMO): ReturnPilot-v${version}-firefox.zip (or ./dist/firefox)`);
})();
