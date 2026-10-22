/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ReturnPilot — Automated Version Synchronization & Bump Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Usage:
 *   node scripts/bump-version.js 4.1.6
 *   node scripts/bump-version.js (syncs all files to match manifest.json)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const targetArg = process.argv[2];

const manifestPath = path.join(rootDir, 'manifest.json');
let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let targetVersion = targetArg ? targetArg.trim() : manifest.version;
if (!targetVersion || !/^\d+\.\d+\.\d+/.test(targetVersion)) {
  console.error(`❌ Invalid version: "${targetVersion}". Expected format like "4.1.6"`);
  process.exit(1);
}

console.log(`\n🔄 Synchronizing ReturnPilot version to v${targetVersion} across entire codebase...\n`);

let filesChanged = 0;

function updateFile(relPath, transformFn) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`  ⚠️ Skip (not found): ${relPath}`);
    return;
  }
  const oldContent = fs.readFileSync(fullPath, 'utf8');
  const newContent = transformFn(oldContent);
  if (oldContent !== newContent) {
    fs.writeFileSync(fullPath, newContent, 'utf8');
    filesChanged++;
    console.log(`  ✔ Updated: ${relPath}`);
  } else {
    console.log(`  ✔ Already up to date: ${relPath}`);
  }
}

// 1. manifest.json
updateFile('manifest.json', (content) => {
  return content.replace(/"version":\s*"[^"]+"/, `"version": "${targetVersion}"`);
});

// 2. package.json
updateFile('package.json', (content) => {
  return content.replace(/"version":\s*"[^"]+"/, `"version": "${targetVersion}"`);
});

// 3. package-lock.json
updateFile('package-lock.json', (content) => {
  return content
    .replace(/"version":\s*"[^"]+"/, `"version": "${targetVersion}"`)
    .replace(/("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*)"[^"]+"/, `$1"${targetVersion}"`);
});

// 4. security/entanglement.js
updateFile('security/entanglement.js', (content) => {
  // Update header
  let updated = content.replace(/ReturnPilot v\d+\.\d+\.\d+/, `ReturnPilot v${targetVersion}`);
  // Update AUTHORIZED_VERSIONS array
  updated = updated.replace(/const AUTHORIZED_VERSIONS = \[([\s\S]*?)\];/, (match, list) => {
    if (list.includes(`'${targetVersion}'`)) return match;
    const items = list.split(',').map(s => s.trim()).filter(Boolean);
    items.push(`'${targetVersion}'`);
    return `const AUTHORIZED_VERSIONS = [${items.join(', ')}];`;
  });
  return updated;
});

// 5. core/xlsx-builder.js
updateFile('core/xlsx-builder.js', (content) => {
  let updated = content.replace(/ReturnPilot v\d+\.\d+\.\d+/, `ReturnPilot v${targetVersion}`);
  updated = updated.replace(/<AppVersion>[^<]+<\/AppVersion>/, `<AppVersion>${targetVersion}</AppVersion>`);
  return updated;
});

// 6. core/consolidated-sales-builder.js
updateFile('core/consolidated-sales-builder.js', (content) => {
  return content.replace(/ReturnPilot Premium v\d+\.\d+\.\d+/, `ReturnPilot Premium v${targetVersion}`);
});

// 7. core/consolidated-purchase-builder.js
updateFile('core/consolidated-purchase-builder.js', (content) => {
  return content.replace(/ReturnPilot Premium v\d+\.\d+\.\d+/, `ReturnPilot Premium v${targetVersion}`);
});

// 7b. core/consolidated-gstr3b-builder.js
updateFile('core/consolidated-gstr3b-builder.js', (content) => {
  return content.replace(/ReturnPilot Premium v\d+\.\d+\.\d+/, `ReturnPilot Premium v${targetVersion}`);
});

// 8. background.js (fallback strings & header)
updateFile('background.js', (content) => {
  let updated = content.replace(/ReturnPilot v\d+\.\d+(\.\d+)? — Background Service Worker/, `ReturnPilot v${targetVersion} — Background Service Worker`);
  return updated.replace(/(manifest \? manifest\.version : )'[^']+'/g, `$1'${targetVersion}'`);
});

// 9. core/logger.js (fallback string)
updateFile('core/logger.js', (content) => {
  return content.replace(/(manifest \? manifest\.version : )'[^']+'/g, `$1'${targetVersion}'`);
});

// 10. TrialAutomater.txt
updateFile('TrialAutomater.txt', (content) => {
  let updated = content.replace(/ReturnPilot - Master Webhook, MIS Automator & Spontaneous Engine \(v\d+\.\d+\.\d+\)/, `ReturnPilot - Master Webhook, MIS Automator & Spontaneous Engine (v${targetVersion})`);
  updated = updated.replace(/Lifecycle Automator Active \(v\d+\.\d+\.\d+\)/, `Lifecycle Automator Active (v${targetVersion})`);
  updated = updated.replace(/const AUTHORIZED_VERSIONS = \[([\s\S]*?)\];/, (match, list) => {
    if (list.includes(`"${targetVersion}"`)) return match;
    const items = list.split(',').map(s => s.trim()).filter(Boolean);
    items.push(`"${targetVersion}"`);
    return `const AUTHORIZED_VERSIONS = [${items.join(', ')}];`;
  });
  return updated;
});

// 11. kasyhq.com FeedbackPage.tsx (if accessible)
const websiteFeedbackPath = path.resolve(rootDir, '../kasyhq.com/src/pages/FeedbackPage.tsx');
if (fs.existsSync(websiteFeedbackPath)) {
  try {
    let content = fs.readFileSync(websiteFeedbackPath, 'utf8');
    if (!content.includes(`"${targetVersion}"`)) {
      content = content.replace(/KNOWN_RELEASED_VERSIONS\s*=\s*\[([\s\S]*?)\];/, (match, list) => {
        const trimmed = list.trimEnd();
        const separator = trimmed.endsWith(',') ? '\n      ' : ',\n      ';
        return `KNOWN_RELEASED_VERSIONS = [${trimmed}${separator}"${targetVersion}"\n    ];`;
      });
      fs.writeFileSync(websiteFeedbackPath, content, 'utf8');
      filesChanged++;
      console.log(`  ✔ Updated: ../kasyhq.com/src/pages/FeedbackPage.tsx`);
    } else {
      console.log(`  ✔ Already up to date: ../kasyhq.com/src/pages/FeedbackPage.tsx`);
    }
  } catch (err) {
    console.warn('  ⚠️ Website version sync note:', err.message);
  }
}

// 12. kasyhq.com functions/api/cws-version.js (if accessible)
const cwsVersionPath = path.resolve(rootDir, '../kasyhq.com/functions/api/cws-version.js');
if (fs.existsSync(cwsVersionPath)) {
  try {
    let content = fs.readFileSync(cwsVersionPath, 'utf8');
    const updated = content.replace(/const FALLBACK_VERSION = '[^']+';/, `const FALLBACK_VERSION = '${targetVersion}';`);
    if (content !== updated) {
      fs.writeFileSync(cwsVersionPath, updated, 'utf8');
      filesChanged++;
      console.log(`  ✔ Updated: ../kasyhq.com/functions/api/cws-version.js`);
    } else {
      console.log(`  ✔ Already up to date: ../kasyhq.com/functions/api/cws-version.js`);
    }
  } catch (err) {
    console.warn('  ⚠️ CWS version sync note:', err.message);
  }
}

console.log(`\n✨ Version synchronization complete! (${filesChanged} files modified to v${targetVersion})\n`);
