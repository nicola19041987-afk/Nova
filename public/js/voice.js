/* voice.js — comandi vocali continui (Web Speech API) e lettura delle risposte (speechSynthesis).
 * L'ascolto si riavvia da solo a ogni evento "end" finché il microfono è acceso: nessun limite di durata.
 * Mentre l'avatar parla l'ascolto è in pausa, per evitare l'eco. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, on = false, pausedForTTS = false, ttsOn = false;
  const status = (t) => { const el = $('#voice-status'); el.hidden = !t; el.textContent = t || ''; };
  function setBtn() {
    $('#mic-btn').classList.toggle('on', on); $('#mic-btn span').textContent = on ? 'Voce: on' : 'Voce: off';
    $('#tts-btn').classList.toggle('on', ttsOn); $('#tts-btn').firstChild.textContent = ttsOn ? '🔊 ' : '🔇 ';
    $('#tts-btn span').textContent = ttsOn ? 'Lettura: on' : 'Lettura: off';
  }
  function build() {
    rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim(); if (!t) continue;
          if ($('#auto-send').checked) { $('#chat-input').value = ''; App.chat.send(t); }
          else { const inp = $('#chat-input'); inp.value = (inp.value ? inp.value + ' ' : '') + t; }
        } else interim += r[0].transcript;
      }
      status(interim ? '🎙️ ' + interim : '🎙️ In ascolto…');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; setBtn(); status('Permesso microfono negato.'); }
      else if (e.error === 'network') status('Riconoscimento vocale non raggiungibile (serve connessione).');
    };
    rec.onend = () => { if (on && !pausedForTTS) setTimeout(() => { try { rec.start(); } catch {} }, 250); }; // riavvio automatico
  }
  App.voice = {
    start() {
      if (!SR) { status('Il riconoscimento vocale non è supportato da questo browser (su iPhone il supporto è parziale). Puoi usare il microfono della tastiera.'); return; }
      if (!App.ls.get('micOn', false)) return App.toast('Attiva il microfono in Account');
      if (!rec) build();
      on = true; setBtn(); status('🎙️ In ascolto…'); try { rec.start(); } catch {}
    },
    ttsOn: () => ttsOn,
    // Frase detta dall'avatar anche con la lettura spenta (es. domanda di conferma)
    sayNow(text) {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT';
      const v = speechSynthesis.getVoices().filter((x) => x.lang && x.lang.toLowerCase().startsWith('it'));
      if (v.length) u.voice = v.find((x) => /female|donna|alice|elsa|federica|paola/i.test(x.name)) || v[0];
      App.avatarConv.speakUtterance(u, text); speechSynthesis.cancel(); speechSynthesis.speak(u);
    },
    stop() { on = false; setBtn(); status(''); if (rec) try { rec.stop(); } catch {} },
    speak(text) {
      if (!ttsOn || !window.speechSynthesis) return;
      const clean = text.replace(/[*_#`>~]/g, '').replace(/\p{Extended_Pictographic}/gu, '').trim(); if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean); u.lang = 'it-IT';
      const v = speechSynthesis.getVoices().filter((x) => x.lang && x.lang.toLowerCase().startsWith('it'));
      if (v.length) u.voice = v.find((x) => /female|donna|alice|elsa|federica|paola/i.test(x.name)) || v[0];
      // pausa ascolto durante la lettura (anti-eco)
      u.addEventListener('start', () => { if (on && rec) { pausedForTTS = true; try { rec.stop(); } catch {} } });
      const resume = () => { if (pausedForTTS) { pausedForTTS = false; if (on) try { rec.start(); } catch {} } };
      u.addEventListener('end', resume); u.addEventListener('error', resume);
      App.avatarConv.speakUtterance(u, clean); // labiale + gesti
      if (App.avatarPresence && !$('#presence').hidden) App.avatarPresence.speakUtterance(u, clean);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    },
  };
  $('#mic-btn').addEventListener('click', () => (on ? App.voice.stop() : App.voice.start()));
  $('#tts-btn').addEventListener('click', () => {
    ttsOn = !ttsOn; App.ls.set('tts', ttsOn); setBtn();
    if (!window.speechSynthesis) { ttsOn = false; setBtn(); App.toast('Lettura vocale non supportata'); }
    if (!ttsOn) speechSynthesis.cancel();
  });
  App.voice.init = () => { ttsOn = App.ls.get('tts', false) && !!window.speechSynthesis; setBtn(); if (window.speechSynthesis) speechSynthesis.getVoices(); };
})();
