/* live.js — fotocamera dal vivo (anteriore/posteriore), modalità "Presenza" (avatar animato sovrapposto alla stanza)
 * e scambio volto dal vivo APPROSSIMATO, tutto sul dispositivo con MediaPipe Face Landmarker (file locali in /vendor).
 * Nessun fotogramma viene inviato al server o a terzi. Volti ammessi: solo Nico, Luisa o volti generati dall'IA. */
// Tracciamento (viso, mani, corpo) in public/js/motion.js (window.Motion): GPU con ripiego su CPU, tutto locale.
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const ANCHORS = [33, 263, 152]; // angolo occhio sx, angolo occhio dx, mento

let stream = null, facing = 'user', mode = 'presence', raf = 0;
let videoLm = null, imageLm = null, src = null; // src = { img, pts, oval }
const video = $('#live-video'), overlay = $('#live-overlay'), octx = overlay.getContext('2d');
App.avatarPresence = new TalkingAvatar($('#presence-avatar'));
App.avatarPresence.transparent = true;

const pStatus = (t) => { const el = $('#presence-status'); if (el) { el.textContent = t || ''; el.hidden = !t; } };
async function startCamera() {
  const ios = window.Motion && Motion.isIOS(), standalone = window.Motion && Motion.isStandalone();
  if (!window.isSecureContext) { App.toast('Fotocamera bloccata: l\'app deve essere aperta in HTTPS'); return false; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    App.toast(ios && standalone ? 'Questa versione di iOS non permette la fotocamera nell\'app installata: apri Nova in Safari' : 'Fotocamera non disponibile: serve un browser recente', 6000); return false;
  }
  stopCamera();
  try {
    // chiamata subito dopo il tocco dell'utente (necessario su iOS Safari); video muto e inline
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true; video.autoplay = true;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 960 }, height: { ideal: 540 } }, audio: false });
    video.srcObject = stream; await video.play();
    const mirror = facing === 'user'; video.classList.toggle('mirror', mirror); overlay.classList.toggle('mirror', mirror);
    return true;
  } catch (e) {
    const msg = e.name === 'NotAllowedError'
      ? (ios && standalone ? 'Permesso fotocamera negato. Nell\'app installata sulla Home, iOS lo chiede di nuovo a ogni apertura: tocca Consenti, oppure controlla Impostazioni > Safari > Fotocamera (o apri Nova in Safari).'
        : ios ? 'Permesso fotocamera negato: Impostazioni > Safari > Fotocamera > Consenti, poi ricarica.' : 'Permesso fotocamera negato')
      : e.name === 'NotReadableError' ? 'La fotocamera è usata da un\'altra app: chiudila e riprova'
      : e.name === 'OverconstrainedError' ? 'Questa fotocamera non è disponibile su questo dispositivo'
      : 'Impossibile avviare la fotocamera (' + (e.name || 'errore') + ')';
    App.toast(msg, 7000); return false;
  }
}
function stopCamera() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; }

async function open() {
  if (!App.ls.get('camOn', false)) return App.toast('Attiva la fotocamera in Impostazioni');
  $('#presence').hidden = false;
  if (!(await startCamera())) { close(); return; }
  if (App.current) App.avatarPresence.setCharacter(App.previews[App.current.id] ? { ...App.current, avatar: App.previews[App.current.id].dataUrl } : App.current);
  App.avatarPresence.gesturesOn = App.ls.get('gestures', true);
  App.avatarPresence.sensual = !!(App.me && App.me.adult);
  setMode(mode); loop(); updateTrackButtons(); startTracking();
}
function close() { if (App.motionStyle) App.motionStyle.save(); cancelAnimationFrame(raf); stopCamera(); $('#presence').hidden = true; octx.clearRect(0, 0, overlay.width, overlay.height); App.avatarPresence.clearMirror(); App.avatarPresence.setRhythm(null); pStatus(''); }

// ---- gesti delle mani + imitazione dei movimenti (modalità Presenza) ----
const proc = window.Motion ? new Motion.Processor() : null;
const handsOn = () => App.ls.get('handGestures', false);
const mirrorOn = () => App.ls.get('mirrorMoves', false);
function updateTrackButtons() {
  $('#live-hands').classList.toggle('on', handsOn()); $('#live-hands').textContent = handsOn() ? '✋ Gesti: on' : '✋ Gesti: off';
  $('#live-mirror').classList.toggle('on', mirrorOn()); $('#live-mirror').textContent = mirrorOn() ? '🪞 Imita i miei movimenti: on' : '🪞 Imita i miei movimenti';
}
let trackMsg = '';
async function startTracking() {
  if (!proc) { pStatus('Tracciamento non disponibile: script motion.js non caricato'); return; }
  const want = [...(handsOn() ? ['hands'] : []), ...(mirrorOn() ? ['face', 'pose'] : [])];
  if (!want.length) { pStatus(''); return; }
  pStatus('Carico il tracciamento sul telefono…');
  const okParts = [], bad = [];
  for (const k of want) {
    try { await Motion.ensure(k); okParts.push(`${Motion.NAMES[k]} (${Motion.delegate[k]})`); }
    catch (e) { if (k === 'pose') console.warn(e); else bad.push(e.message); } // il corpo è facoltativo
  }
  const cpu = okParts.some((p) => p.includes('CPU')) ? ' · GPU non disponibile: uso la CPU (più lento)' : '';
  trackMsg = bad.length ? '⚠️ ' + bad.join(' ') : `Attivo: ${okParts.join(', ')}${cpu}. Tutto sul telefono, nessun video inviato.`;
  pStatus(trackMsg); setTimeout(() => { if (!bad.length) pStatus(''); }, 5000);
}
function track(now) {
  if (!proc || mode !== 'presence' || (!handsOn() && !mirrorOn())) return;
  const r = proc.process(video, now, { mirrorX: facing === 'user', hands: handsOn(), face: mirrorOn(), pose: mirrorOn() });
  if (!r) return;
  const av = App.avatarPresence;
  if (r.gesture) { const [kind, badge] = Motion.REACTIONS[r.gesture] || []; if (kind) av.react(kind, badge); }
  if (mirrorOn()) {
    if (r.mirror) av.setMirror(r.mirror); av.setRhythm(r.rhythm ? r.rhythm.period : null, r.rhythm ? r.rhythm.strength : 0);
    // impara lo stile dell'utente (solo su questo telefono, per profilo) e lo passa agli avatar ogni ~2 s
    if (App.motionStyle && r.mirror) { App.motionStyle.update(r.mirror, r.rhythm, handsOn() ? r.gesture : undefined, now); if (now - (track.lastStyle || 0) > 2000) { track.lastStyle = now; App.applyStyle(); } }
  }
}
$('#live-hands').addEventListener('click', () => { App.ls.set('handGestures', !handsOn()); updateTrackButtons(); startTracking(); });
$('#live-mirror').addEventListener('click', () => { App.ls.set('mirrorMoves', !mirrorOn()); updateTrackButtons(); if (!mirrorOn()) { App.avatarPresence.clearMirror(); App.avatarPresence.setRhythm(null); } startTracking(); });
function setMode(m) {
  mode = m;
  $('#live-mode').textContent = mode === 'presence' ? '🎭 Volto dal vivo' : '🧍 Presenza';
  $('#presence-avatar').hidden = mode !== 'presence'; $('#faceswap-panel').hidden = mode !== 'face';
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (mode === 'face') { fillFaces(); ensureLandmarker(); }
}

// ---- MediaPipe (locale) ----
async function ensureLandmarker() {
  if (videoLm && imageLm) return true;
  try {
    $('#live-status').textContent = 'Carico il riconoscimento del viso (sul telefono)…';
    videoLm = await Motion.ensure('face');      // runningMode VIDEO (fotogrammi della fotocamera)
    imageLm = await Motion.imageFace();          // runningMode IMAGE (foto del volto da applicare)
    $('#live-status').textContent = `Pronto (${Motion.delegate.face === 'GPU' ? 'GPU' : 'CPU: GPU non disponibile'}). Tutto avviene sul telefono: nessun video viene inviato.`;
    return true;
  } catch (e) {
    $('#live-status').textContent = '⚠️ ' + (e.message || 'Riconoscimento del viso non disponibile su questo dispositivo/browser.'); return false;
  }
}
function fillFaces() {
  const opts = App.chars.filter((c) => /^\/api\/avatars\//.test(c.avatar) || App.previews[c.id])
    .map((c) => `<option value="${esc(App.previews[c.id] ? App.previews[c.id].dataUrl : c.avatar)}">Volto di ${esc(c.name)} (IA)</option>`).join('');
  $('#live-face').innerHTML = '<option value="">— scegli —</option>' + opts + '<option value="upload">📱 Foto di Nico o Luisa dal telefono…</option>';
}
async function setSource(url, isUpload) {
  src = null; if (!url) return;
  if (isUpload && !$('#live-consent').checked) { App.toast('Spunta prima la dichiarazione di consenso'); $('#live-face').value = ''; return; }
  if (!(await ensureLandmarker())) return;
  const img = new Image(); img.src = url; await img.decode();
  const r = imageLm.detect(img); const lm = r.faceLandmarks && r.faceLandmarks[0];
  if (!lm) { App.toast('Nessun volto trovato in questa immagine'); return; }
  const P = (i) => ({ x: lm[i].x * img.naturalWidth, y: lm[i].y * img.naturalHeight });
  src = { img, pts: ANCHORS.map(P) };
  $('#live-status').textContent = 'Volto applicato (approssimazione sul dispositivo).';
}
$('#live-face').addEventListener('change', (e) => { const v = e.target.value; if (v === 'upload') $('#live-face-file').click(); else setSource(v, false); });
$('#live-face-file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) setSource(await App.fileToDataUrl(f, 1024), true); e.target.value = ''; });
$('#live-consent').addEventListener('change', (e) => { if (!e.target.checked && src && $('#live-face').value === 'upload') src = null; });

// trasformazione affine da 3 punti (sorgente -> destinazione)
function affine(s, d) {
  const [a, b, c] = s; const det = a.x * (b.y - c.y) - a.y * (b.x - c.x) + (b.x * c.y - c.x * b.y);
  if (Math.abs(det) < 1e-6) return null;
  const solve = (v0, v1, v2) => [
    (v0 * (b.y - c.y) - a.y * (v1 - v2) + (v1 * c.y - v2 * b.y)) / det,
    (a.x * (v1 - v2) - v0 * (b.x - c.x) + (b.x * v2 - c.x * v1)) / det,
    (a.x * (b.y * v2 - c.y * v1) - a.y * (b.x * v2 - c.x * v1) + v0 * (b.x * c.y - c.x * b.y)) / det,
  ];
  const [m11, m12, tx] = solve(d[0].x, d[1].x, d[2].x); const [m21, m22, ty] = solve(d[0].y, d[1].y, d[2].y);
  return [m11, m21, m12, m22, tx, ty];
}
const tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');
function drawFace(lm) {
  const W = overlay.width, H = overlay.height; const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const m = affine(src.pts, ANCHORS.map(P)); if (!m) return;
  tmp.width = W; tmp.height = H; tctx.clearRect(0, 0, W, H);
  tctx.setTransform(...m); tctx.drawImage(src.img, 0, 0); tctx.setTransform(1, 0, 0, 1, 0, 0);
  // maschera ovale del viso con bordi sfumati
  tctx.globalCompositeOperation = 'destination-in'; tctx.filter = `blur(${Math.round(W / 90)}px)`;
  tctx.beginPath(); FACE_OVAL.forEach((i, k) => { const p = P(i); k ? tctx.lineTo(p.x, p.y) : tctx.moveTo(p.x, p.y); }); tctx.closePath(); tctx.fill();
  tctx.filter = 'none'; tctx.globalCompositeOperation = 'source-over';
  octx.globalAlpha = Number($('#live-opacity').value) / 100; octx.drawImage(tmp, 0, 0); octx.globalAlpha = 1;
}
let lastT = -1;
function loop() {
  raf = requestAnimationFrame(loop);
  if (!video.videoWidth) return;
  if (overlay.width !== video.videoWidth) { overlay.width = video.videoWidth; overlay.height = video.videoHeight; }
  if (mode !== 'face') { track(performance.now()); return; }
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!videoLm || !src || video.currentTime === lastT) return;
  lastT = video.currentTime;
  const r = videoLm.detectForVideo(video, Math.round(performance.now()));
  const lm = r.faceLandmarks && r.faceLandmarks[0]; if (lm) drawFace(lm);
}

// scatto: unisce fotocamera + sovrapposizioni e lo salva (con conferma) nella galleria privata
$('#live-shot').addEventListener('click', async () => {
  if (!video.videoWidth) return;
  if (!confirm('Salvare lo scatto nella galleria privata?\nConfermi che ritrae solo te o il tuo partner (con consenso) o volti generati dall\'IA, e nessuna terza persona reale?')) return;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; const ctx = c.getContext('2d');
  if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0); ctx.drawImage(overlay, 0, 0); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (mode === 'presence') { const a = $('#presence-avatar'); const s = c.height * 0.55; ctx.drawImage(a, c.width - s - c.width * 0.04, c.height - s - c.height * 0.12, s, s); }
  try { await App.api('/api/images/upload', { method: 'POST', body: { dataUrl: c.toDataURL('image/jpeg', 0.9), consent: true, prompt: mode === 'presence' ? 'Presenza' : 'Volto dal vivo' } }); App.toast('📸 Salvato in galleria'); App.media.load(); }
  catch (e) { App.toast(e.message); }
});
$('#presence-btn').addEventListener('click', open);
$('#live-close').addEventListener('click', close);
$('#live-flip').addEventListener('click', async () => { facing = facing === 'user' ? 'environment' : 'user'; await startCamera(); });
$('#live-mode').addEventListener('click', () => setMode(mode === 'presence' ? 'face' : 'presence'));
$('#presence-chat').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#presence-input'); const t = i.value; i.value = ''; if (App.current) App.chat.send(t); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !$('#presence').hidden) close(); });
