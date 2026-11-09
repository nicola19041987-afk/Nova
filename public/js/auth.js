/* auth.js — login e attivazione account con consenso vocale (UNA sola volta). */
// Accesso: scegli il profilo (Nico / Luisa) e inserisci il PIN a 4 cifre.
// Primo avvio: ogni profilo imposta il proprio PIN UNA volta; poi non è più reimpostabile da qui (solo admin: npm run reset-pin).
let pinProfile = null, pinSetup = false, needsSetupCode = false;
App.showLogin = async function () {
  App.showView('login'); $('#login-error').textContent = ''; $('#pin-form').hidden = true;
  const title = $('#login-title'); if (title) title.textContent = 'Nova';
  const lead = $('#login-lead'); if (lead) lead.hidden = false;
  try {
    const { profiles, setupCode } = await App.api('/api/profiles'); needsSetupCode = setupCode;
    $('#profile-pick').hidden = false;
    $('#profile-pick').innerHTML = profiles.map((p) => `<button type="button" class="login-profile" data-profile="${p.id}" data-has="${p.hasPin}" data-name="${esc(p.name)}">${esc(p.name)}<small>${p.hasPin ? 'Inserisci il PIN' : 'Primo accesso'}</small></button>`).join('');
    const last = localStorage.getItem('ap:lastProfile');
    const lp = profiles.find((p) => p.id === last && p.hasPin); if (lp) pickProfile(lp.id, true, lp.name);
  } catch (e) { $('#login-error').textContent = e.message; }
};
function pickProfile(id, hasPin, name) {
  pinProfile = id; pinSetup = !hasPin;
  $('#profile-pick').hidden = true; $('#pin-form').hidden = false;
  const title = $('#login-title'); if (title) title.textContent = pinSetup ? 'Scegli il PIN' : 'Inserisci il PIN';
  const lead = $('#login-lead'); if (lead) lead.hidden = true;
  $('#pin-title').textContent = pinSetup ? `Ciao ${name}. Si imposta una sola volta.` : `Ciao ${name}.`;
  $('#pin-confirm').hidden = !pinSetup; $('#pin-confirm').required = pinSetup;
  $('#setup-code').hidden = !(pinSetup && needsSetupCode);
  $('#pin-submit').textContent = 'Avanti';
  $('#pin-input').value = ''; $('#pin-confirm').value = ''; $('#pin-input').focus();
}
$('#profile-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-profile]'); if (!b) return;
  if (App.armMic) App.armMic(true);
  pickProfile(b.dataset.profile, b.dataset.has === 'true', b.dataset.name);
});
$('#pin-back').addEventListener('click', () => { localStorage.removeItem('ap:lastProfile'); App.showLogin(); });
$('#pin-input').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); if (!pinSetup && e.target.value.length === 4) $('#pin-form').requestSubmit(); });
$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#login-error').textContent = '';
  if (App.armMic) App.armMic(true);
  const pin = $('#pin-input').value;
  if (!/^\d{4}$/.test(pin)) { $('#login-error').textContent = 'Il PIN deve avere 4 cifre'; return; }
  try {
    if (pinSetup) {
      if (pin !== $('#pin-confirm').value) { $('#login-error').textContent = 'I PIN non coincidono'; return; }
      await App.api('/api/pin/setup', { method: 'POST', body: { user: pinProfile, pin, setupCode: $('#setup-code').value } });
    } else await App.api('/api/login', { method: 'POST', body: { user: pinProfile, pin } });
    localStorage.setItem('ap:lastProfile', pinProfile);
    $('#pin-input').value = ''; App._fromPin = true; await App.boot();
  } catch (err) { $('#login-error').textContent = err.message; $('#pin-input').value = ''; }
});
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="logout"]')) return;
  await App.api('/api/logout', { method: 'POST' }).catch(() => {});
  App.me = null; App.showLogin();
});

// ---- consenso vocale: registra con MediaRecorder, salva sul server con data e ora ----
let rec = null, chunks = [], blob = null, stream = null;
App.showActivation = async function () {
  App.showView('activate');
  try { $('#consent-phrase').textContent = (await App.api('/api/consent/phrase')).phrase; } catch {}
};
function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
$('#rec-btn').addEventListener('click', async () => {
  const err = $('#rec-error'); err.textContent = '';
  if (rec && rec.state === 'recording') { rec.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { err.textContent = 'Registrazione non supportata: serve HTTPS e un browser recente.'; return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { err.textContent = 'Permesso microfono negato. Abilitalo nelle impostazioni del browser.'; return; }
  const mime = pickMime(); chunks = [];
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
    const a = $('#rec-preview'); a.src = URL.createObjectURL(blob); a.hidden = false;
    $('#rec-actions').hidden = false; $('#rec-btn').textContent = '🎙️ Registra consenso vocale';
    $('#rec-status').textContent = 'Ascolta e conferma.';
  };
  rec.start(); $('#rec-btn').textContent = '⏹️ Ferma registrazione';
  $('#rec-status').textContent = '🔴 Registrazione in corso… leggi la frase.';
});
$('#rec-redo').addEventListener('click', () => { blob = null; $('#rec-preview').hidden = true; $('#rec-actions').hidden = true; $('#rec-status').textContent = ''; });
$('#rec-save').addEventListener('click', async () => {
  if (!blob) return;
  try {
    const r = await App.api('/api/consent', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type.split(';')[0] || 'audio/webm' } });
    App.ls.set('consent', { activatedAt: r.consent.activatedAt }); // segnalino locale
    App.toast('✅ Account attivato'); App.boot();
  } catch (e) { $('#rec-error').textContent = e.message; }
});
