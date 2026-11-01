// Copia in public/vendor/mediapipe i file di MediaPipe Face Landmarker (per lo scambio volto dal vivo, tutto sul dispositivo).
// Eseguito automaticamente dopo "npm install". Il modello face_landmarker.task è già incluso; se manca prova a scaricarlo.
const fs = require('fs');
const path = require('path');
const https = require('https');
const dest = path.join(__dirname, '..', 'public', 'vendor', 'mediapipe');
fs.mkdirSync(path.join(dest, 'wasm'), { recursive: true });
let src;
src = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision');
if (!fs.existsSync(path.join(src, 'vision_bundle.mjs'))) { console.warn('@mediapipe/tasks-vision non installato: scambio volto dal vivo non disponibile.'); process.exit(0); }
fs.copyFileSync(path.join(src, 'vision_bundle.mjs'), path.join(dest, 'vision_bundle.mjs'));
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  fs.copyFileSync(path.join(src, 'wasm', f), path.join(dest, 'wasm', f));
}
const model = path.join(dest, 'face_landmarker.task');
if (fs.existsSync(model)) { console.log('MediaPipe pronto in public/vendor/mediapipe'); process.exit(0); }
const url = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
https.get(url, (r) => {
  if (r.statusCode !== 200) { console.warn('Modello non scaricato (HTTP ' + r.statusCode + ')'); return; }
  r.pipe(fs.createWriteStream(model)).on('finish', () => console.log('Modello face_landmarker scaricato.'));
}).on('error', (e) => console.warn('Modello non scaricato:', e.message));
