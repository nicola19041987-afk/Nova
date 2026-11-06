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
      <h3>Appunto per assistenza</h3>
      <p class="muted small">Scrivi o detta. Puoi correggere il testo prima di inviare.</p>
      <textarea id="support-text" rows="5" maxlength="4000" placeholder="Cosa non funziona?"></textarea>
      <p id="support-status" class="muted small"></p>
      <div class="row">
        <button type="button" id="support-mic" class="block">🎙️ Detta</button>
        <button type="button" id="support-stop" class="block" hidden>Stop</button>
      </div>
      <div class="row">
        <button type="submit" value="send" class="primary block" id="support-send">Invia</button>
        <button type="submit" value="cancel" class="block">Chiudi</button>
      </div>
    </form>`;
    document.body.appendChild(d);
    $('#support-mic').addEventListener('click', () => start($('#support-text'), $('#support-status')));
    $('#support-stop').addEventListener('click', () => stop());
    d.addEventListener('close', () => { stop(); if (d.returnValue === 'send') send($('#support-text').value); });
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
    if (!text) { App.toast('Scrivi un appunto'); return; }
    try {
      const r = await App.api('/api/support-notes', { method: 'POST', body: { text } });
      App.toast(r.delivered ? 'Inviato ✓' : 'Salvato, invio appena possibile');
    } catch (e) { App.toast(e.message || 'Invio non riuscito'); }
  }
  function open() {
    const d = dlg();
    $('#support-text').value = '';
    $('#support-status').textContent = '';
    d.returnValue = '';
    d.showModal();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#support-note-btn, #support-note-settings')) { e.preventDefault(); open(); }
  });
  App.supportNote = { open };
})();
