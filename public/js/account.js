/* account.js — chiave xAI (solo sul dispositivo), privacy, fotocamera/microfono, regole, memoria, storico consenso. */
App.account = {
  async load() {
    // chiave
    $('#key-input').value = App.key();
    $('#key-status').textContent = App.key() ? 'Chiave salvata su questo dispositivo.' : (App.me && App.me.serverKey ? 'Chiave già configurata sul server, condivisa.' : 'Nessuna chiave su questo dispositivo.');
    try {
      const simli = await App.api('/api/simli/key/status');
      const line = $('#simli-key-status');
      if (line) line.textContent = simli.configured ? 'Chiave Simli configurata sul server.' : 'Nessuna chiave Simli: in videochiamata resta la foto.';
    } catch { /* lo stato Simli non blocca il resto */ }
    $('#key-warning').hidden = App.hasAi();
    // privacy (server) + preferenze locali
    App.settings = await App.api('/api/settings'); App.ls.set('settings', App.settings);
    $('#set-autosave').checked = App.settings.autoSave; $('#set-export').checked = App.settings.allowExport;
    $('#set-video-model').value = App.settings.videoModel || ''; $('#set-video-duration').value = App.settings.videoDuration || 6;
    $('#video-info').textContent = App.me.videoEnabled ? `Modello predefinito del server: ${App.me.videoModel}` : 'Video non configurato sul server (VIDEO_PATH vuoto).';
    $('#set-mic').checked = App.ls.get('micOn', false); $('#set-cam').checked = App.ls.get('camOn', false);
    $('#set-gestures').checked = App.ls.get('gestures', true); $('#set-learn-gestures').checked = App.ls.get('handGestures', false); $('#set-mirror-moves').checked = App.ls.get('mirrorMoves', false);
    App.applyDevicePrefs();
    // modalità adulti (per utente, solo dopo il consenso vocale). v8.3.1: subito dopo le impostazioni, così un errore
    // nel caricare regole/memoria/note non lascia l'interruttore bloccato o con lo stato sbagliato
    $('#set-adult').checked = !!App.settings.adultMode; $('#set-adult').disabled = false;
    await App.account.adultStatus();
    try {
      const kw = await App.api('/api/adult-keyword'); App.kwSet = kw.set;
      $('#kw-input').value = ''; $('#kw-input').placeholder = kw.set ? '•••••• (impostata: scrivi per cambiarla)' : 'vuoto = funzione spenta';
    } catch { /* riprova al prossimo caricamento */ }
    try { // regole: server + copia locale
    let rules = await App.api('/api/rules');
    const local = App.ls.get('rules', null);
    if (!rules.text && local && local.text) rules = await App.api('/api/rules', { method: 'PUT', body: { text: local.text } });
    App.ls.set('rules', rules); $('#rules-input').value = rules.text || '';
    // memoria
    await this.loadMemory();
    $('#mem-auto').checked = App.ls.get('memAuto', true);
    // note personali (solo mie)
    const notes = await App.api('/api/notes');
    $('#notes-input').value = notes.text || ''; $('#notes-ai').checked = !!notes.toAI;
    } catch (e) { console.warn('Impostazioni: caricamento parziale', e.message); }
    this.renderConsent();
  },
  // v8.3.1: stato della modalità adulti di ENTRAMBI, con cosa manca e a chi (le regole non cambiano: servono tutti e due)
  async adultStatus() {
    let st = null; try { st = await App.api('/api/adult-status'); } catch { /* offline */ }
    App.adultStatus = st;
    { const ok = !!(App.me && App.me.admin && st && st.chat); $('#nobrakes-row').hidden = !ok; $('#nobrakes-info').hidden = !ok; $('#set-nobrakes').checked = !!(App.settings && App.settings.noBrakes); } // v8.5.0
    const el = $('#adult-info'); if (!el) return st;
    if (!st) { el.textContent = App.settings.adultMode ? 'Attiva per te.' : 'Disattivata.'; return st; }
    el.innerHTML = App.adultText(st, true); el.classList.toggle('ok', st.chat);
    return st;
  },
  renderConsent() {
    const c = App.me.consent;
    $('#consent-info').innerHTML = c
      ? `<p>✅ Account attivato il <b>${esc(fmtDate(c.activatedAt))}</b> con consenso vocale (modalità adulti disponibile: si attiva in «Modalità adulti (18+)»).</p>
         <blockquote>${esc(c.phrase)}</blockquote><audio controls src="/api/consent/audio" preload="none"></audio>`
      : '<p>Account non ancora attivato.</p>';
  },
  // Memoria CONDIVISA: niente ripristino dalla copia del dispositivo (resusciterebbe ricordi cancellati dall'altro profilo).
  async loadMemory() { this.setMemory(await App.api('/api/memory')); },
  setMemory(mem) { App.memory = mem; App.ls.del('memory'); this.renderMemory(); },
  renderMemory() {
    const ul = $('#mem-list');
    ul.innerHTML = App.memory.length ? App.memory.map((m) => `<li data-id="${m.id}"><span class="grow">${esc(m.text)} ${m.source === 'auto' ? '<span class="badge">auto</span>' : m.byName ? `<span class="badge">${esc(m.byName)}</span>` : ''}</span>
      <button data-mem-edit>✏️</button><button data-mem-del>🗑️</button></li>`).join('') : '<li class="muted">Ancora nessun ricordo.</li>';
  },
  async saveMemory(list) { this.setMemory(await App.api('/api/memory', { method: 'PUT', body: list })); },
  async remember(text) {
    text = (text || '').trim(); if (!text) return;
    const f = await App.api('/api/memory', { method: 'POST', body: { text } });
    this.setMemory([...App.memory, f]); App.toast('🧠 Ricordato');
  },
};
// Applica le preferenze dispositivo (fotocamera/microfono spenti di default)
App.applyDevicePrefs = () => {
  const cam = App.ls.get('camOn', false), mic = App.ls.get('micOn', false);
  $$('.cam-only').forEach((el) => { el.hidden = !cam; });
  $('#mic-btn').hidden = !mic;
  if (App.avatarConv) App.avatarConv.gesturesOn = App.ls.get('gestures', true);
};

$('#key-toggle').addEventListener('click', () => { const i = $('#key-input'); i.type = i.type === 'password' ? 'text' : 'password'; });
$('#key-save').addEventListener('click', () => {
  const k = $('#key-input').value.trim();
  if (!/^\S{10,300}$/.test(k)) return App.toast('Chiave non valida');
  App.ls.set('key', k); App.account.load(); App.toast('🔑 Chiave salvata solo su questo dispositivo');
});
$('#key-clear').addEventListener('click', () => { App.ls.del('key'); $('#key-input').value = ''; App.account.load(); });
const simliToggle = document.getElementById('simli-key-toggle');
if (simliToggle) simliToggle.addEventListener('click', () => { const i = $('#simli-key-input'); i.type = i.type === 'password' ? 'text' : 'password'; });
const simliSave = document.getElementById('simli-key-save');
if (simliSave) simliSave.addEventListener('click', async () => {
  const key = ($('#simli-key-input').value || '').trim();
  const faceId = ($('#simli-face-input').value || '').trim();
  if (!/^\S{8,400}$/.test(key)) return App.toast('Chiave Simli non valida');
  try {
    const body = { key };
    if (faceId) body.faceId = faceId;
    const st = await App.api('/api/simli/key', { method: 'POST', body });
    $('#simli-key-input').value = '';
    $('#simli-key-status').textContent = st.configured ? 'Chiave Simli configurata sul server.' : 'Nessuna chiave Simli: in videochiamata resta la foto.';
    App.toast('Chiave Simli salvata sul server');
  } catch (e) { App.toast(e.message || 'Chiave Simli non salvata'); }
});
const pinChange = document.getElementById('pin-change');
if (pinChange) pinChange.addEventListener('click', async () => {
  const current = (document.getElementById('pin-now').value || '').trim();
  const pin = (document.getElementById('pin-new').value || '').trim();
  if (!/^\d{4}$/.test(pin)) return App.toast('Il nuovo PIN deve avere 4 cifre');
  try {
    await App.api('/api/pin/change', { method: 'POST', body: { current, pin } });
    document.getElementById('pin-now').value = '';
    document.getElementById('pin-new').value = '';
    App.toast('PIN aggiornato');
  } catch (e) { App.toast(e.message || 'PIN non cambiato'); }
});

async function saveSettings() {
  App.settings = await App.api('/api/settings', { method: 'PUT', body: { ...App.settings, adultMode: $('#set-adult').checked, noBrakes: $('#set-adult').checked && $('#set-nobrakes').checked, autoSave: $('#set-autosave').checked, allowExport: $('#set-export').checked, videoModel: $('#set-video-model').value.trim(), videoDuration: Number($('#set-video-duration').value) } });
  App.ls.set('settings', App.settings); App.media && App.media.renderAll(); App.feed && App.feed.render();
}
$('#set-autosave').addEventListener('change', saveSettings);
$('#set-export').addEventListener('change', saveSettings);
$('#set-video-save').addEventListener('click', async () => { await saveSettings(); App.toast('Salvato'); });
$('#set-mic').addEventListener('change', (e) => { App.ls.set('micOn', e.target.checked); if (!e.target.checked && App.voice) App.voice.stop(); App.applyDevicePrefs(); });
$('#set-cam').addEventListener('change', (e) => { App.ls.set('camOn', e.target.checked); if (!e.target.checked && App.media) App.media.stopCamera(); App.applyDevicePrefs(); });
$('#set-gestures').addEventListener('change', (e) => { App.ls.set('gestures', e.target.checked); App.applyDevicePrefs(); });
// Gesti delle mani / imitazione: MediaPipe locale (public/js/motion.js), attivi nella modalità Presenza. Servono anche "Usa la fotocamera".
$('#set-learn-gestures').addEventListener('change', (e) => {
  App.ls.set('handGestures', e.target.checked);
  $('#learn-gestures-info').textContent = e.target.checked ? (App.ls.get('camOn', false) ? 'Attivo: apri una chat e tocca 📷 Presenza. Tutto sul telefono, nessun video inviato.' : 'Attiva anche "Usa la fotocamera" qui sopra, poi apri 📷 Presenza in chat.') : 'Disattivato.';
});
$('#set-mirror-moves').addEventListener('change', (e) => { App.ls.set('mirrorMoves', e.target.checked); });
$('#motion-style-reset').addEventListener('click', () => { if (!App.motionStyle) return; App.motionStyle.reset(); App.applyStyle(); App.toast('Stile di movimento dimenticato (solo su questo telefono)'); });

$('#rules-save').addEventListener('click', async () => {
  const r = await App.api('/api/rules', { method: 'PUT', body: { text: $('#rules-input').value } });
  App.ls.set('rules', r); $('#rules-status').textContent = `Salvate il ${fmtDate(r.updatedAt)}`;
});

$('#mem-auto').addEventListener('change', (e) => App.ls.set('memAuto', e.target.checked));
$('#mem-add').addEventListener('click', async () => { await App.account.remember($('#mem-new').value); $('#mem-new').value = ''; });
$('#mem-clear').addEventListener('click', async () => {
  if (!confirm('Cancellare tutta la memoria condivisa (per Nico e Luisa)? Non si può annullare.')) return;
  await App.api('/api/memory', { method: 'DELETE' }); App.account.setMemory([]);
});
$('#mem-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const id = li.dataset.id; const m = App.memory.find((x) => x.id === id);
  if (e.target.closest('[data-mem-del]')) { await App.api(`/api/memory/${id}`, { method: 'DELETE' }); await App.account.loadMemory(); }
  if (e.target.closest('[data-mem-edit]')) {
    const t = prompt('Modifica ricordo', m.text); if (t === null) return;
    if (t.trim()) await App.api(`/api/memory/${id}`, { method: 'PATCH', body: { text: t } }); else await App.api(`/api/memory/${id}`, { method: 'DELETE' });
    await App.account.loadMemory();
  }
});

// "Cancella tutto": conferma + PIN + parola CANCELLA, poi pulizia server e dispositivo e uscita.
$('#wipe-btn').addEventListener('click', async () => {
  const pins = $('#wipe-pins').checked;
  if (!confirm(`Cancellare TUTTI i dati dell'app per entrambi i profili${pins ? ', PIN inclusi' : ''}? L'operazione non si può annullare.`)) return;
  const word = prompt('Per confermare scrivi: CANCELLA'); if (word !== 'CANCELLA') return App.toast('Annullato');
  const pin = prompt('Inserisci il tuo PIN'); if (!pin) return;
  try {
    await App.api('/api/wipe', { method: 'POST', body: { confirm: word, pin, wipePins: pins, wipeBackups: $('#wipe-backups').checked } });
  } catch (e) { return App.toast(e.message); }
  await App.wipeDevice();
  alert('Tutti i dati sono stati cancellati.'); location.replace('/');
});
// Recupero personaggi (solo aggiuntivo: i personaggi presenti non vengono toccati)
$('#recovery-scan').addEventListener('click', async () => {
  $('#recovery-status').textContent = 'Ricerca…';
  try {
    const r = await App.api('/api/recovery');
    $('#recovery-list').innerHTML = r.candidates.map((c) => `<li><label class="switch grow"><input type="checkbox" data-rec="${esc(c.id)}" checked> ${App.avatarHtml(c)} <b>${esc(c.name)}</b> <span class="muted small">${c.messages} messaggi · ${esc(c.source)}</span></label></li>`).join('');
    $('#recovery-go').hidden = !r.candidates.length;
    $('#recovery-status').textContent = r.candidates.length ? `${r.candidates.length} personaggi recuperabili · ${r.backups.length} copie di sicurezza` : `Nessun personaggio da recuperare · ${r.backups.length} copie di sicurezza`;
  } catch (e) { $('#recovery-status').textContent = e.message; }
});
$('#recovery-go').addEventListener('click', async () => {
  const ids = $$('#recovery-list [data-rec]').filter((x) => x.checked).map((x) => x.dataset.rec);
  if (!ids.length) return App.toast('Seleziona almeno un personaggio');
  try {
    const r = await App.api('/api/recovery', { method: 'POST', body: { ids } });
    await App.loadChars(); App.chat.renderList();
    $('#recovery-list').innerHTML = ''; $('#recovery-go').hidden = true;
    $('#recovery-status').textContent = r.restored.length ? `Recuperati: ${r.restored.map((x) => `${x.name} (${x.messages} messaggi)`).join(', ')}` : 'Nulla da recuperare';
  } catch (e) { $('#recovery-status').textContent = e.message; }
});
App.wipeDevice = async function () {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  try { if (indexedDB.databases) for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name); } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch {}
  App.previews = {}; App.me = null;
};

$('#notes-save').addEventListener('click', async () => {
  const n = await App.api('/api/notes', { method: 'PUT', body: { text: $('#notes-input').value, toAI: $('#notes-ai').checked } });
  $('#notes-status').textContent = `Salvate il ${fmtDate(n.updatedAt)}`;
});
$('#set-adult').addEventListener('change', async (e) => {
  if (e.target.checked && App.me && !App.me.activated) { e.target.checked = false; App.showActivation(); return; }
  if (e.target.checked && !confirm('Attivare la modalità adulti (18+)? Contenuti espliciti solo tra adulti consenzienti e con personaggi inventati adulti (25+). Puoi disattivarla quando vuoi.')) { e.target.checked = false; return; }
  try {
    await saveSettings(); App.applyAdult && App.applyAdult();
    const st = await App.account.adultStatus();
    if (e.target.checked && st) App.toast(st.chat ? '🔓 Modalità adulti attiva per entrambi' : `✅ Attiva per te · manca il consenso di ${st.missing.filter((m) => !m.me).map((m) => m.name).join(' e ')} (vedi sotto)`, 6000);
    App.sync && App.sync(); App.actions && App.actions.refresh();
    App.account.load();
  }
  catch (err) { e.target.checked = false; App.toast(err.message); }
});

$('#kw-save').addEventListener('click', async () => {
  const v = $('#kw-input').value;
  if (!v.trim() && App.kwSet && !confirm('Togliere la parola chiave?')) return;
  try { const r = await App.api('/api/adult-keyword', { method: 'PUT', body: { keyword: v } }); App.kwSet = r.set; $('#kw-input').value = ''; App.toast(r.set ? '🔑 Parola chiave salvata (cifrata)' : 'Parola chiave rimossa'); App.account.load(); }
  catch (e) { App.toast(e.message); }
});

// Testo chiaro: chi l'ha attivata, chi no e come fare (es. «Manca il consenso di Luisa»)
App.adultText = function (st, html) {
  const e = html ? esc : (t) => t;
  const row = (u) => `${u.on ? '✅' : '⏳'} <b>${e(u.me ? u.name + ' (tu)' : u.name)}</b>: ${u.on ? 'attiva' : !u.activated ? 'manca il consenso vocale' : 'non ancora attivata'}`;
  const other = st.missing.filter((m) => !m.me), meMiss = st.missing.find((m) => m.me);
  let head;
  if (st.chat) head = '🔓 Attiva per entrambi: nelle chat di coppia i contenuti per adulti sono sbloccati (sempre graduali e naturali, solo personaggi adulti 25+ con volto IA).';
  else if (meMiss && meMiss.need === 'consenso') head = 'Prima serve il tuo consenso vocale (una volta sola, da questo interruttore). La Home resta aperta.';
  else if (meMiss) head = `Attivala qui sopra.${other.length ? ` Poi serve anche ${other.map((m) => e(m.name)).join(' e ')}.` : ' L\'altra persona l\'ha già attivata: manchi solo tu.'}`;
  else head = other.map((m) => m.need === 'consenso'
    ? `⏳ Manca il consenso di ${e(m.name)}: deve accedere con il suo profilo, registrare una volta il consenso vocale e poi attivare «Modalità adulti (18+)» in ${App.SETTINGS_NAME || 'Impostazioni'}.`
    : `⏳ Manca il consenso di ${e(m.name)}: deve accedere con il suo profilo → ${App.SETTINGS_NAME || 'Impostazioni'} → «Modalità adulti (18+)». Finché non la attiva anche ${e(m.name)}, le chat restano senza contenuti espliciti.`).join(' ');
  if (!html) return head.replace(/<[^>]+>/g, '');
  return `<span class="adult-head">${head}</span><span class="adult-rows">${st.users.map(row).join('<br>')}</span>`;
};

// v8.5.0: «Senza freni» (solo Nicola, visibile solo con la modalità adulti attiva per entrambi)
$('#set-nobrakes').addEventListener('change', async (e) => {
  try { await saveSettings(); App.toast(e.target.checked ? '🔥 Senza freni: attivo' : 'Senza freni: spento'); } catch (err) { e.target.checked = !e.target.checked; App.toast(err.message); }
});
