// Controllo sintassi di tutti i file JS del progetto: npm run check
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const files = ['server.js', ...fs.readdirSync(path.join(root, 'scripts')).map((f) => 'scripts/' + f),
  'public/sw.js', 'public/avatar.js', ...fs.readdirSync(path.join(root, 'public/js')).map((f) => 'public/js/' + f)].filter((f) => f.endsWith('.js'));
let bad = 0;
for (const f of files) { try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); console.log('ok  ', f); } catch (e) { bad++; console.log('ERR ', f, String(e.stderr)); } }
process.exit(bad ? 1 : 0);
