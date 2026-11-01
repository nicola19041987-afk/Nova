// Prepara public/vendor/mediapipe per il tracciamento sul dispositivo (viso, mani, corpo) — eseguito dopo "npm install".
// Tutto viene copiato da node_modules/@mediapipe/tasks-vision: nessun download da internet, nessuna CDN a runtime.
// I modelli .task (face_landmarker, hand_landmarker, pose_landmarker_lite) sono inclusi nel repository.
const fs = require('fs');
const path = require('path');
const dest = path.join(__dirname, '..', 'public', 'vendor', 'mediapipe');
const src = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision');
fs.mkdirSync(path.join(dest, 'wasm'), { recursive: true });
if (!fs.existsSync(path.join(src, 'vision_bundle.mjs'))) {
  console.warn('[mediapipe] @mediapipe/tasks-vision non installato: tracciamento e volto dal vivo non disponibili.');
  process.exit(0);
}
let ok = true;
const copy = (from, to) => {
  try { fs.copyFileSync(from, to); } catch (e) { ok = false; console.warn('[mediapipe] copia non riuscita:', path.basename(from), e.message); }
};
copy(path.join(src, 'vision_bundle.mjs'), path.join(dest, 'vision_bundle.mjs'));
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  copy(path.join(src, 'wasm', f), path.join(dest, 'wasm', f));
}
for (const m of ['face_landmarker.task', 'hand_landmarker.task', 'pose_landmarker_lite.task']) {
  if (!fs.existsSync(path.join(dest, m))) { ok = m === 'pose_landmarker_lite.task' ? ok : false; console.warn(`[mediapipe] modello mancante: public/vendor/mediapipe/${m} (va incluso nel repository)`); }
}
console.log(ok ? '[mediapipe] pronto in public/vendor/mediapipe (wasm copiati da node_modules)' : '[mediapipe] preparato con avvisi (vedi sopra)');
