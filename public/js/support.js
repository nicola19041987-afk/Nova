/* support.js — Appunto per assistenza (testo o voce), per Nico e Luisa. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null, recStop = null;
  function dlg() {
    let d = $('#support-dialog');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'support-dialog'; d.className = 'sheet';
    d.innerHTML = `<form method="dialog" id="support-form">
      <button type="button" id="support-x" class="avatar-x" aria-label="Chiudi">✕</button>
      <h3>Appunto per assistenza</h3>
      <div id="support-thread" class="support-thread" aria-live="polite"></div>
      <p class="muted small">Scrivi o detta. Puoi correggere il testo prima di inviare.</p>
      <textarea id="support-text" rows="5" maxlength="4000" placeholder="Cosa non funziona?"></textarea>
      <p id="support-status" class="muted small"></p>
      <div class="row">
        <button type="button" id="support-mic" class="block">🎙️ Detta</button>
        <button type="button" id="support-stop" class="block" hidden>Stop</button>
      </div>
      <div class="row">
        <button type="button" class="primary block" id="support-send">Invia</button>
        <button type="submit" value="cancel" class="block" id="support-cancel">Chiudi</button>
      </div>
    </form>`;
    (document.getElementById('app-shell') || document.body).appendChild(d);
    $('#support-mic').addEventListener('click', () => start($('#support-text'), $('#support-status')));
    $('#support-stop').addEventListener('click', () => stop());
    $('#support-send').addEventListener('click', () => send($('#support-text').value));
    $('#support-x').addEventListener('click', () => d.close());
    d.addEventListener('close', () => stop());
    return d;
  }
  function stop() {
    try { recog && recog.stop(); } catch {}
    recog = null;
    if (recStop) { const f = recStop; recStop = null; f(); }
    const b = $('#support-mic'), s = $('#support-stop');
    if (b) b.hidden = false;
    if (s) s.hidden = true;
  }
  function start(ta, status) {
    stop();
    if (SR) {
      const r = recog = new SR();
      r.lang = 'it-IT'; r.interimResults = true; r.continuous = true;
      const base = ta.value.trim();
      r.onresult = (ev) => {
        let fin = '', mid = '';
        for (let i = 0; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) fin += t + ' '; else mid += t;
        }
        ta.value = [base, fin.trim(), mid.trim()].filter(Boolean).join(' ');
      };
      r.onerror = () => { status.textContent = 'Riconoscimento del telefono non disponibile. Provo la trascrizione xAI…'; recog = null; recordXai(ta, status); };
      r.onend = () => { if (recog === r) { recog = null; status.textContent = 'Puoi correggere il testo prima di inviare.'; const b = $('#support-mic'), s = $('#support-stop'); if (b) b.hidden = false; if (s) s.hidden = true; } };
      try { r.start(); status.textContent = 'Ti ascolto…'; $('#support-mic').hidden = true; $('#support-stop').hidden = false; return; }
      catch { recog = null; }
    }
    recordXai(ta, status);
  }
  async function recordXai(ta, status) {
    if (!navigator.mediaDevices) { status.textContent = 'Microfono non disponibile: scrivi il testo.'; return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { status.textContent = 'Permesso microfono negato. Puoi scrivere il testo.'; return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC({ sampleRate: 24000 });
    const src = ac.createMediaStreamSource(stream);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    const gain = ac.createGain(); gain.gain.value = 0;
    proc.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0), pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
      chunks.push(pcm.buffer.slice(0));
    };
    src.connect(proc); proc.connect(gain); gain.connect(ac.destination);
    status.textContent = 'Registrazione… premi Stop, poi correggi il testo.';
    $('#support-mic').hidden = true; $('#support-stop').hidden = false;
    recStop = () => {
      try { proc.disconnect(); src.disconnect(); gain.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ac.close().catch(() => {});
      status.textContent = 'Trascrivo…';
      const blob = App.callMic && App.callMic._wav ? App.callMic._wav(chunks) : null;
      if (!blob) { status.textContent = 'Trascrizione non disponibile: scrivi il testo.'; return; }
      App.api('/api/stt', { method: 'POST', body: blob, headers: { 'Content-Type': 'audio/wav' }, ai: true })
        .then((r) => { const t = String(r.text || '').trim(); if (t) ta.value = (ta.value ? ta.value + ' ' : '') + t; status.textContent = 'Puoi correggere il testo prima di inviare.'; })
        .catch((e) => { status.textContent = (e && e.message) || 'Trascrizione non riuscita: scrivi il testo.'; });
    };
  }
  async function send(raw) {
    const text = String(raw || '').trim();
    const ta = $('#support-text');
    if (!text) { App.toast('Scrivi un appunto'); return false; }
    try {
      const r = await App.api('/api/support-notes', { method: 'POST', body: { text } });
      if (!r || r.ok === false) throw new Error('Salvataggio non riuscito');
      App.toast(r.delivered ? 'Inviato' : 'Salvato, verrà inoltrato');
      if (ta) ta.value = '';
      if (r.note) paint([r.note].concat(currentNotes().filter((n) => n.id !== r.note.id)));
      else await loadThread();
      return true;
    } catch (e) {
      App.toast((e && e.message) || 'Salvataggio non riuscito');
      return false;
    }
  }
  function currentNotes() {
    const box = $('#support-thread');
    return (box && box._notes) || [];
  }
  function paint(notes) {
    const box = $('#support-thread'); if (!box) return;
    const list = (notes || []).slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    box._notes = list;
    box.innerHTML = list.length ? list.map((n) => `<article>
      <p class="who">${esc(n.author || '')} · ${esc(n.status === 'inviato' ? 'inviato' : 'in attesa')}</p>
      <p class="txt">${esc(n.text || '')}</p>
      <p class="reply"><b>Nova</b> ${esc((n.reply && n.reply.text) || '')}</p>
    </article>`).join('') : '<p class="muted small">Nessun appunto ancora.</p>';
    box.scrollTop = box.scrollHeight;
  }
  async function loadThread() {
    const r = await App.api('/api/support-notes');
    paint(r.notes || []);
  }
  async function open() {
    const d = dlg();
    $('#support-text').value = '';
    $('#support-status').textContent = '';
    d.returnValue = '';
    if (App.closeSheets) App.closeSheets(d);
    const chiudi = d.querySelector('button[value="cancel"]'); if (chiudi) chiudi.disabled = false;
    if (!d.open) d.showModal();
    try { await loadThread(); } catch (e) { paint([]); }
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#support-note-btn, #support-note-settings')) { e.preventDefault(); open(); }
  });
  App.supportNote = { open };
})();
