/* diag.js — v8.4.1/v8.4.5 «Diagnostica voce» (Impostazioni → Voce): prova passo per passo token, WebSocket del tempo reale,
 * configurazione della sessione, microfono, trascrizione e voce, con i tempi. Risultato leggibile in uno screenshot. */
(function () {
  const btn = document.getElementById('voice-diag'), out = document.getElementById('voice-diag-out');
  if (!btn) return;
  const ms = (t) => Math.round(performance.now() - t) + ' ms';
  // v8.4.2: per ogni errore mostra quale chiamata è fallita, lo stato HTTP di xAI e il corpo della risposta (già ripulito dal server: nessuna chiave o token)
  const why = (e) => [e.message, e.call ? 'chiamata ' + e.call : '', e.upstream ? 'HTTP xAI ' + e.upstream : (e.status ? 'HTTP ' + e.status : ''), e.detail && !String(e.message).includes(String(e.detail).slice(0, 40)) ? 'risposta: ' + String(e.detail).replace(/xai-[A-Za-z0-9_-]{6,}/g, 'xai-***').slice(0, 300) : ''].filter(Boolean).join(' · ');
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function device() {
    const ua = navigator.userAgent, ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const iv = (ua.match(/OS (\d+)_(\d+)/) || [])[0], av = (ua.match(/Android (\d+(\.\d+)?)/) || [])[1], cv = (ua.match(/Chrome\/(\d+)/) || [])[1];
    return ios ? `iPhone/iPad iOS ${iv ? iv.slice(3).replace('_', '.') : '?'}` : av ? `Android ${av}${cv ? ' · Chrome ' + cv : ''}` : (cv ? 'Chrome ' + cv : ua.slice(0, 60));
  }
  async function run() {
    const rows = []; let fatal = false;
    const row = (st, k, v) => { rows.push({ st, k, v }); draw(); };
    const draw = () => { out.hidden = false; out.innerHTML = `<div class="diag-head">🩺 Diagnostica voce · v8.5.0 · ${new Date().toLocaleString('it-IT')}</div>` + rows.map((r) => `<div class="diag-row ${r.st}"><span>${r.st === 'ok' ? '✅' : r.st === 'warn' ? '⚠️' : r.st === 'run' ? '⏳' : '❌'}</span><b>${esc(r.k)}</b><span>${esc(r.v)}</span></div>`).join('') + (btn.disabled ? '' : '<button type="button" id="voice-diag-copy" class="small">📋 Copia il risultato</button>'); const c = document.getElementById('voice-diag-copy'); if (c) c.onclick = () => { const t = rows.map((r) => `${r.st.toUpperCase()} ${r.k}: ${r.v}`).join('\n'); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => App.toast('Copiato'), () => App.toast('Fai uno screenshot')); }; };
    btn.disabled = true; btn.textContent = '⏳ Diagnostica in corso…';
    const AC = window.AudioContext || window.webkitAudioContext;
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    row('ok', 'Dispositivo', `${device()}${standalone ? ' · app installata' : ' · browser'}`);
    const need = [['WebSocket', !!window.WebSocket], ['AudioContext', !!AC], ['AudioWorklet', !!(AC && AC.prototype && 'audioWorklet' in AC.prototype)], ['Microfono (getUserMedia)', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)], ['Connessione sicura (HTTPS)', !!window.isSecureContext]];
    const miss = need.filter(([, v]) => !v).map(([k]) => k);
    row(miss.length ? 'err' : 'ok', 'Compatibilità', miss.length ? 'manca: ' + miss.join(', ') : 'WebSocket, AudioWorklet, microfono, HTTPS' + (navigator.audioSession ? ' · sessione audio iOS ' + navigator.audioSession.type : ''));
    row('ok', 'Impostazione chiamate', App.ls.get('callEngine', 'realtime') === 'realtime' ? '⚡ tempo reale' : 'classica (scelta nelle Impostazioni)');
    if (!App.key()) { row('err', 'Chiave xAI', 'mancante: inseriscila sopra'); btn.disabled = false; btn.textContent = '🩺 Diagnostica voce'; draw(); return; }
    row('ok', 'Chiave xAI', 'presente su questo telefono');
    // 1) server -> xAI
    try { const t = performance.now(); const r = await App.api('/api/ai-warm', { method: 'POST', ai: true }); row(r.status === 200 ? 'ok' : 'warn', 'Server → xAI', `${ms(t)} (HTTP ${r.status || '?'}${r.status === 200 ? '' : ' · chiave non valida?'}) · modello chiamate: ${r.callModel || '?'}`); } catch (e) { row('err', 'Server → xAI', e.message); }
    // 2) token effimero
    const ch = App.current || (App.chars || [])[0]; let cfg = null;
    if (!ch) row('warn', 'Token tempo reale', 'nessun personaggio da provare');
    else try { const t = performance.now(); cfg = await App.api('/api/realtime/session', { method: 'POST', body: { characterId: ch.id, mode: 'voice' }, ai: true }); row('ok', 'Token tempo reale', `${ms(t)} · scade tra ${cfg.expiresAt ? Math.round(cfg.expiresAt - Date.now() / 1000) + ' s' : '?'} · modello ${cfg.model} · voce ${cfg.session && cfg.session.voice}`); }
    catch (e) { fatal = true; row('err', 'Token tempo reale', why(e)); }
    // 3) WebSocket + configurazione
    if (cfg) await new Promise((done) => {
      const t = performance.now(); let ws, step = 'open', fin = false, to;
      const end = (st, msg) => { if (fin) return; fin = true; clearTimeout(to); if (st) row(st, 'Sessione', msg); try { ws.close(1000); } catch {} setTimeout(done, 50); };
      try { ws = new WebSocket(cfg.url, [`xai-client-secret.${cfg.token}`]); } catch (e) { row('err', 'WebSocket', e.message); return done(); }
      to = setTimeout(() => end('err', `nessuna risposta entro 8 s (fase: ${step})`), 8000);
      ws.onopen = () => { row('ok', 'WebSocket', `aperto in ${ms(t)} · ${new URL(cfg.url).host} · sottoprotocollo ${ws.protocol ? 'accettato' : 'non confermato'}`); step = 'session.created'; };
      ws.onerror = () => row('err', 'WebSocket', 'errore di rete o accesso rifiutato');
      ws.onclose = (e) => { if (!fin) end('err', `chiusa dal servizio: codice ${e.code}${e.reason ? ' · ' + e.reason : ''} (fase: ${step})`); };
      let u = 0;
      ws.onmessage = (m) => {
        let ev; try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === 'session.created') { row('ok', 'session.created', ms(t)); step = 'session.update'; ws.send(JSON.stringify({ type: 'session.update', session: cfg.session })); }
        else if (ev.type === 'session.updated') { u++; if (u === 1) { row('ok', 'session.update', `accettata in ${ms(t)} (istruzioni, voce, VAD del server, PCM 24 kHz)`); if (cfg.extra) { step = 'extra'; ws.send(JSON.stringify({ type: 'session.update', session: cfg.extra })); setTimeout(() => end('ok', 'tempo reale pronto ✔'), 1200); } else end('ok', 'tempo reale pronto ✔'); } else end('ok', 'tempo reale pronto ✔ (trascrizione grok-transcribe accettata)'); }
        else if (ev.type === 'error') { const er = ev.error || {}; const msg = `${er.message || er.code || 'errore'}${er.param ? ' · campo ' + er.param : ''}`; if (step === 'extra') end('ok', 'tempo reale pronto ✔ (opzione facoltativa non accettata, non serve: ' + msg + ')'); else { row('err', 'session.update', msg); step = 'dopo errore'; setTimeout(() => end('warn', 'il servizio ha rifiutato la configurazione (la chiamata usa la configurazione a passi)'), 300); } }
      };
    });
    // 4) microfono (1,5 s) + trascrizione
    let clip = null;
    try {
      // v8.4.7: sessione 'play-and-record' PRIMA del microfono, contesto audio creato/rinnovato DOPO (iPhone), 3 s con conto alla rovescia
      row('run', 'Microfono', 'apro il microfono…');
      let prevType = null; try { if (navigator.audioSession) { prevType = navigator.audioSession.type; navigator.audioSession.type = 'play-and-record'; } } catch { /* */ }
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      let c = App.audio.ctx;
      if (!c || (navigator.audioSession && prevType !== 'play-and-record')) c = App.audio.renewCtx ? App.audio.renewCtx('diagnostica') : (App.audio.ctx = new AC());
      if (c.state !== 'running') await c.resume().catch(() => {});
      const src = c.createMediaStreamSource(st); await c.audioWorklet.addModule('/js/rt-worklet.js');
      const node = new AudioWorkletNode(c, 'rt-capture'), sink = c.createGain(); sink.gain.value = 0; src.connect(node); node.connect(sink); sink.connect(c.destination);
      const chunks = []; let peak = 0; node.port.onmessage = (e) => { chunks.push(e.data.pcm); peak = Math.max(peak, e.data.rms); };
      const tr = st.getAudioTracks()[0]; let mutedSeen = tr.muted; tr.onmute = () => { mutedSeen = true; };
      for (let k = 3; k > 0; k--) { rows.pop(); row('run', 'Microfono', `🎙️ Parla ora… ${k}  · livello ${(peak * 100).toFixed(1)}%`); await new Promise((r) => setTimeout(r, 1000)); }
      const info = `traccia ${tr.readyState}${mutedSeen ? ' MUTA' : ''} · contesto ${c.state} ${c.sampleRate} Hz · sessione iOS ${navigator.audioSession ? navigator.audioSession.type + (prevType && prevType !== navigator.audioSession.type ? ' (era ' + prevType + ')' : '') : 'n/d'}`;
      try { node.disconnect(); src.disconnect(); sink.disconnect(); } catch {} st.getTracks().forEach((x) => x.stop());
      rows.pop(); row(peak > 0.01 ? 'ok' : 'warn', 'Microfono', `livello massimo ${(peak * 100).toFixed(1)}%${peak > 0.01 ? '' : ' (molto basso: hai parlato?)'} · ${info}`);
      clip = chunks;
    } catch (e) { rows.pop(); row('err', 'Microfono', e.name === 'NotAllowedError' ? 'permesso negato (Impostazioni del telefono → Safari/Chrome → Microfono)' : e.message); }
    if (clip && App.callMic) try { const t = performance.now(); const r = await App.api('/api/stt', { method: 'POST', body: App.callMic._wav(clip), headers: { 'Content-Type': 'audio/wav' }, ai: true }); row('ok', 'Trascrizione xAI', `${ms(t)} · "${(r.text || '').slice(0, 60) || '(silenzio)'}"`); } catch (e) { row('warn', 'Trascrizione xAI', why(e) + ' (la chiamata classica userà il riconoscimento del telefono)'); }
    // 5) voce (TTS): elenco voci, poi una frase con la voce scelta
    const myVoice = App.ls.get('ttsVoice', 'ara');
    try { const v = await App.api('/api/tts/voices', { ai: true }); const ids = (v.voices || []).map((x) => x.id);
      if (v.error) row('warn', 'Elenco voci xAI', why({ message: v.error, call: v.call, upstream: v.status, detail: v.detail }) + ' · uso l\'elenco di riserva');
      else row(ids.includes(String(myVoice).toLowerCase()) ? 'ok' : 'warn', 'Elenco voci xAI', `${ids.length} voci · scelta: ${myVoice}${ids.includes(String(myVoice).toLowerCase()) ? '' : ' (non in elenco: verrà usata «eve»)'}`);
    } catch (e) { row('warn', 'Elenco voci xAI', why(e)); }
    try {
      const t = performance.now(); const r = await App.api('/api/tts', { method: 'POST', body: { text: 'Prova.', voice: App.ls.get('ttsVoice', 'ara') }, ai: true, raw: true });
      if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; e.call = j.call || 'tts'; e.upstream = j.status; e.detail = j.detail; throw e; }
      const first = ms(t); const fb = r.headers.get('X-TTS-Fallback'); const b = await r.blob(); row(fb ? 'warn' : 'ok', 'Voce xAI', `primo audio ${first} · ${Math.round(b.size / 1024)} kB${fb ? ' · prima richiesta rifiutata (HTTP ' + fb + '), riuscita con i campi base' : ''}`);
    } catch (e) { row('warn', 'Voce xAI', why(e)); }
    // 6) ultime chiamate
    const lt = App.latency && App.latency.median('tempo reale'), lc = App.latency && App.latency.median('classica');
    row('ok', 'Ritardo misurato (mediana)', `${lt ? 'tempo reale ' + (lt / 1000).toFixed(2) + ' s' : 'tempo reale: nessuna misura'} · ${lc ? 'classica ' + (lc / 1000).toFixed(2) + ' s' : 'classica: nessuna misura'}`);
    { const L = (App.latency && App.latency.log || []).filter((x) => x.path === 'classica').slice(-3); // v8.4.5: dettaglio dei tempi
      if (L.length) row('ok', 'Ultimi turni classici', L.map((x) => `${x.stt != null ? 'testo ' + (x.stt / 1000).toFixed(1) + ' s → ' : ''}${x.tok != null ? 'prima parola ' + (x.tok / 1000).toFixed(1) + ' s → ' : ''}voce ${(x.ms / 1000).toFixed(1)} s`).join(' · ')); }
    if (App.voice && App.voice.mode) row('ok', 'Modalità voce (fuori chiamata)', { xai: 'microfono continuo + trascrizione xAI (italiano)', telefono: 'riconoscimento del telefono (riserva)', off: 'spenta' }[App.voice.mode()] || App.voice.mode());
    { const a = App.avatarConv; if (a) row(a._safe || a._stalls ? 'warn' : 'ok', 'Animazione avatar', `${a._safe ? 'modalità semplice (' + (a._lastErr || 'errore di disegno') + ')' : a.breather && a.breather.ok ? 'respiro WebGL' : 'respiro semplice'} · blocchi ripresi: ${a._stalls || 0} · movimento CSS sempre attivo`); }
    if (App.rt && App.rt.lastError) row('warn', 'Ultimo errore tempo reale', App.rt.lastError);
    const log = App.rt && App.rt.log ? App.rt.log() : []; if (log.length) row('ok', 'Ultima chiamata (eventi)', log.slice(-8).map((x) => x.t + (x.d ? ' ' + x.d : '')).join(' → '));
    row(fatal ? 'err' : 'ok', 'Esito', fatal ? 'il tempo reale non può partire: vedi le righe rosse' : 'fatto · fai uno screenshot se qualcosa è rosso o giallo');
    btn.disabled = false; btn.textContent = '🩺 Diagnostica voce'; draw();
  }
  btn.addEventListener('click', () => { App.audio.unlock(); run().catch((e) => { btn.disabled = false; btn.textContent = '🩺 Diagnostica voce'; App.toast('Diagnostica: ' + e.message); }); });
})();
