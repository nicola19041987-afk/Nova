#!/usr/bin/env node
// Reset del PIN da parte dell'amministratore (sul server).
// Uso: npm run reset-pin -- nico   (oppure luisa)
// Cancella il PIN del profilo e sblocca i tentativi: al prossimo accesso dall'app si sceglie un nuovo PIN.
// Ferma il server prima di eseguirlo (o riavvialo dopo).
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ALIASES = { nico: 'nicola', nicola: 'nicola', luisa: 'luisa' };
const user = ALIASES[(process.argv[2] || '').toLowerCase()];
if (!user) { console.error('Uso: npm run reset-pin -- nico|luisa'); process.exit(1); }
for (const f of ['pins.json', 'lockout.json']) {
  const p = path.join(DATA_DIR, f);
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, 'utf8')); delete j[user];
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
// chiude anche le sessioni aperte di quel profilo
const sp = path.join(DATA_DIR, 'sessions.json');
if (fs.existsSync(sp)) { const s = JSON.parse(fs.readFileSync(sp, 'utf8')); for (const k of Object.keys(s)) if (s[k].user === user) delete s[k]; fs.writeFileSync(sp, JSON.stringify(s, null, 2)); }
console.log(`PIN di ${user === 'nicola' ? 'Nico' : 'Luisa'} azzerato. Riavvia il server: al prossimo accesso si imposta un nuovo PIN.`);
