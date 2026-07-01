import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('panel/index.html', 'utf8');
const css = readFileSync('panel/assets/style.css', 'utf8');
const js = readFileSync('panel/assets/app.js', 'utf8');

const banner = '// Generated from panel/. Do not edit manually and do not put secrets here.\n';
writeFileSync(
  'worker/src/panel-assets.js',
  `${banner}export const PANEL_HTML = ${JSON.stringify(html)};\n\nexport const PANEL_CSS = ${JSON.stringify(css)};\n\nexport const PANEL_APP_JS = ${JSON.stringify(js)};\n`,
);
console.log('panel assets generated');
