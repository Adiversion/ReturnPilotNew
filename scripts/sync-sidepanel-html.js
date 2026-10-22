const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pilotHtmlPath = path.join(rootDir, 'popup', 'ReturnPilot.html');
const sidepanelHtmlPath = path.join(rootDir, 'popup', 'sidepanel.html');

if (!fs.existsSync(pilotHtmlPath)) {
  console.error('ReturnPilot.html not found!');
  process.exit(1);
}

let content = fs.readFileSync(pilotHtmlPath, 'utf8');

// Ensure root html and body have sidepanel class
content = content.replace('<html lang="en">', '<html lang="en" class="rp-view-sidepanel">');
content = content.replace('<body>', '<body class="rp-view-sidepanel">');

// Set surface toggle button defaults for side panel view
content = content.replace(
  '<span id="surfaceToggleText">Side Panel</span>',
  '<span id="surfaceToggleText">Normal Extension</span>'
);
content = content.replace(
  'id="surfaceToggleIconSide" width="12" height="12"',
  'id="surfaceToggleIconSide" width="12" height="12" style="display:none;"'
);
content = content.replace(
  'id="surfaceToggleIconWindow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"',
  'id="surfaceToggleIconWindow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;"'
);

// Toggle active button in profile surface selector
content = content.replace(
  '<button type="button" class="pd-surface-btn active" id="pdViewBtnPopup"',
  '<button type="button" class="pd-surface-btn" id="pdViewBtnPopup"'
);
content = content.replace(
  '<button type="button" class="pd-surface-btn" id="pdViewBtnSidepanel"',
  '<button type="button" class="pd-surface-btn active" id="pdViewBtnSidepanel"'
);

// Inject sidepanel-specific override CSS — must survive every sync/build regeneration.
// This link is added AFTER the shared app.css so overrides take precedence.
content = content.replace(
  '<link rel="stylesheet" href="../assets/styles/app.css">',
  '<link rel="stylesheet" href="../assets/styles/app.css">\n    <link rel="stylesheet" href="sidepanel-overrides.css">'
);

fs.writeFileSync(sidepanelHtmlPath, content, 'utf8');
console.log('✔ Successfully synced popup/sidepanel.html from ReturnPilot.html (' + content.length + ' bytes)');
