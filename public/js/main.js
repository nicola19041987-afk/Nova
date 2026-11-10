/* main.js — avvio, navigazione a schede, cambi automatici giornalieri, service worker. */
document.title = 'Nova';
App.avatarConv = new TalkingAvatar($('#avatar-canvas'));
App.avatarEditor = new TalkingAvatar($('#editor-canvas'));

App.applySessionDefaults = function () {
  if (!App.me) return;
  if (App.ls.get('micPicked') !== true) App.ls.set('micOn', true);
  const engine = App.ls.get('callEngine', null);
  if (engine == null || engine === '') App.ls.set('callEngine', 'realtime');
};
App.armMic = function (fromGesture) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (fromGesture) App.toast('Microfono non disponibile su questo browser.');
    return Promise.resolve(false);
  }
  const p = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    App._micPrime = stream;
    return true;
  }).catch((e) => {
    App._micPrime = null;
    if (!fromGesture) return false;
    const denied = !e || e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'PermissionDeniedError';
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    App.toast(denied
      ? (ios ? 'Microfono non consentito. Su iPhone: Impostazioni → Safari → Microfono → Consenti, poi tocca di nuovo il profilo.' : 'Microfono non consentito. Consenti il microfono per questo sito e tocca di nuovo il profilo.')
      : ('Microfono non avviato. ' + ((e && e.message) || '')));
    return false;
  });
  App._micPrimeP = p;
  return p;
};
App.askConsentOnce = function () {
  const bar = document.getElementById('adult-ask');
  if (!bar || !App.me) return;
  if (App.me.activated || App.ls.get('consentAsked')) { bar.hidden = true; return; }
  bar.hidden = false;
};
App.startLiveDefaults = function () {
  if (navigator.webdriver) return;
  // In chat il microfono non ascolta da solo: è solo il tasto da tenere premuto per la nota vocale.
  if (document.body.classList.contains('solo-mode')) {
    if (App.voice && App.voice.isListening && App.voice.isListening() && App.voice.stop) App.voice.stop();
    return;
  }
  if (App.ls.get('micOn') !== false && App.voice && App.voice.start && !(App.voice.isListening && App.voice.isListening())) App.voice.start();
  if (App.ls.get('soloRtOff') === true || App.ls.get('callEngine', 'realtime') === 'classic') return;
  if (App.solo && App.solo.toggleRt && !document.body.classList.contains('solo-rt')) App.solo.toggleRt();
};
App.boot = async function () {
  try { App.me = await App.api('/api/me'); } catch { App.showLogin(); return; }
  if (App.me.consent) App.ls.set('consent', { activatedAt: App.me.consent.activatedAt });
  App.applySessionDefaults();
  App.askConsentOnce();
  App.showView('app'); $('#who').textContent = App.me.name;
  App.opts = await App.api('/api/characters/options');
  await App.loadChars();
  App.editor.init(); App.voice.init();
  await App.account.load();
  App.chat.renderList();
  try { if (App.solo) await App.solo.boot(); } catch (e) { console.warn(e); }
  try { App.startLiveDefaults(); } catch (e) { console.warn(e); }
  App.media.load().catch(() => {}); App.feed.load().catch(() => {});
  App.applyAdult();
  App.motionStyle = null; // v8.6.0: niente apprendimento dai movimenti in camera
  App.applyStyle = function () { /* no-op: stile fisso, realistico */ };
  App.applyStyle();
  // voce sempre attiva (non resta muta)
  try { App.ls.set('ttsOn', true); App.ls.set('readOn', true); } catch {}
  $('#tab-conv').classList.toggle('compact', !!App.ls.get('avatarCompact', false));
  App.actions && App.actions.load();
  App.sync();
  App.autoChanges();
  setTimeout(() => App.faceMigrate && App.faceMigrate(), 6000);
  // In solo la home è la conversazione con Nova. 'chat' è la lista personaggi, che qui non esiste.
  if (!document.body.classList.contains('solo-mode')) document.body.dataset.tab = 'chat';
  else if (document.body.dataset.tab !== 'account') document.body.dataset.tab = 'conv';
  if (App.roles) App.roles.apply(); if (App.home) App.home.boot();
  try { if (App.archive && App.archive.wanted()) await App.archive.open(); } catch (e) { console.warn(e); }
  // Dopo il PIN (e a ogni avvio) la prima schermata è la chat, non i comandi.
  if (document.body.classList.contains('solo-mode') && !document.body.classList.contains('archive-on') && App.solo && App.solo.showChat) App.solo.showChat();
  App._fromPin = false;
};
// Modalità adulti (per utente): solo effetti locali sull'avatar (espressioni/movimenti più sensuali, canvas).
App.applyAdult = function () {
  App.me.adult = !!(App.me.activated && App.settings.adultMode);
  [App.avatarConv, App.avatarEditor, App.avatarPresence].forEach((a) => { if (a) a.sensual = App.me.adult; });
};

// Stile di movimento appreso (solo locale, per profilo): rende più naturale l'imitazione e il comportamento a riposo
App.applyStyle = function () {
  if (!App.motionStyle) return; const p = App.motionStyle.profile();
  [App.avatarConv, App.avatarEditor, App.avatarPresence].forEach((a) => a && a.setStyle(p));
};

// Cambi automatici: al primo avvio del giorno (o secondo la frequenza scelta), piccole variazioni plausibili
App.autoChanges = async function () {
  if (!App.hasAi() || !(App.me && (App.me.admin || App.me.editor))) return;
  for (const c of App.chars) {
    const ac = c.autoChanges || {};
    if (!ac.enabled || !/^\/api\/avatars\//.test(c.avatar)) continue;
    if (ac.lastAt && Date.now() - Date.parse(ac.lastAt) < ac.everyDays * 864e5 - 2 * 3600e3) continue;
    try {
      const r = await App.api(`/api/characters/${c.id}/auto-change`, { method: 'POST', ai: true, body: {} });
      if (r.character) { Object.assign(c, r.character); App.toast(`✨ ${c.name} ha cambiato look: ${r.changes.join(', ')}`, 5000); }
      else if (r.preview) { App.previews[c.id] = r.preview; c.autoChanges.lastAt = new Date().toISOString(); App.toast(`✨ ${c.name} propone un nuovo look (${r.changes.join(', ')}): aprila per salvarlo`, 6000); }
      App.chat.renderList();
    } catch { /* riprova al prossimo avvio */ }
  }
};

const TITLES = { chat: 'Chat', calls: 'Chiamate', feed: 'Diario', images: 'Galleria', account: 'Impostazioni' };
App.TITLES = TITLES;
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => App.openTab(b.dataset.tab)));
// v8.4: navigazione tra le schede (anche dalla Home). La conversazione resta aperta dentro «Chat».
App.openTab = function (t) {
  if (App.home) App.home.hide();
  $$('.tabbar button').forEach((x) => x.classList.toggle('active', x.dataset.tab === t));
  ['chat', 'conv', 'calls', 'feed', 'images', 'account'].forEach((n) => { const el = $(`#tab-${n}`); if (el) el.hidden = true; });
  document.title = 'Nova';
  const solo = document.body.classList.contains('solo-mode');
  if (solo && t === 'chat') {
    if (App.solo && App.solo.showChat) App.solo.showChat();
    else {
      const ch = App.solo && App.solo.char && App.solo.char();
      if (ch && (!App.current || App.current.id !== ch.id)) App.chat.open(ch.id);
      $('#tab-conv').hidden = false; $('#back-btn').hidden = true;
      $('#title').textContent = (App.current && App.current.name) || 'Nova';
      document.body.dataset.tab = 'conv';
    }
    $('#large-title').hidden = true;
    if (App.chat && App.chat.header) App.chat.header();
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    window.scrollTo(0, 0); return;
  }
  const conv = t === 'chat' && App.current;
  if (conv) { $('#tab-conv').hidden = false; $('#back-btn').hidden = !!solo; $('#title').textContent = App.current.name; }
  else { $(`#tab-${t}`).hidden = false; $('#back-btn').hidden = true; $('#title').textContent = TITLES[t] || t; }
  document.body.dataset.tab = conv ? 'conv' : t;
  $('#large-title').textContent = TITLES[t] || t; $('#large-title').hidden = !!conv || solo;
  if (App.chat && App.chat.header) App.chat.header();
  if (t === 'feed') App.feed.load().catch(() => {});
  if (t === 'calls' && App.calls) App.calls.load();
  if (t === 'images' && App.gallery) App.gallery.load();
  if (solo && t === 'account' && App.solo && App.solo.setDock) {
    document.body.classList.remove('solo-chat');
    App.solo.setDock('settings');
    const back = $('#back-btn');
    if (back) { back.hidden = false; back.setAttribute('aria-label', 'Torna alla chat'); }
  }
  window.scrollTo(0, 0);
};

// v8.4.5: aggiornamento dell'app SENZA ricaricare e mai durante una chiamata o mentre parlate: la nuova versione resta in
// attesa e si attiva quando l'app è libera (verrà usata al prossimo avvio). Nessun location.reload() automatico.
App.swBusy = () => !!((App.call && App.call.active) || (App.voice && App.voice.isListening && App.voice.isListening()) || (App.tts && App.tts.playing) || (App.chat && App.chat.busy));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then((reg) => {
  const tryActivate = () => { const w = reg.waiting; if (!w) return; if (App.swBusy()) { App.swPending = true; return; } App.swPending = false; w.postMessage({ type: 'SKIP_WAITING' }); };
  reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') tryActivate(); }); });
  tryActivate(); setInterval(tryActivate, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tryActivate(); });
}).catch(() => {}));
App.refreshApp = async function () {
  const btn = document.getElementById('app-refresh');
  if (btn) btn.disabled = true;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.update) await reg.update();
      const w = reg && (reg.waiting || reg.installing);
      if (w) {
        w.postMessage({ type: 'SKIP_WAITING' });
        await new Promise((res) => {
          const done = () => res();
          navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
          setTimeout(done, 1200);
        });
      }
    }
  } catch { /* si ricarica comunque: la sessione è nel cookie */ }
  location.reload();
};
const refreshBtn = document.getElementById('app-refresh');
if (refreshBtn) refreshBtn.addEventListener('click', () => App.refreshApp());
App.boot();
(function () {
  const go = document.getElementById('adult-ask-go');
  const later = document.getElementById('adult-ask-later');
  const hide = () => { const bar = document.getElementById('adult-ask'); if (bar) bar.hidden = true; if (App.ls && App.me) App.ls.set('consentAsked', true); };
  if (go) go.addEventListener('click', () => { hide(); if (App.armMic) App.armMic(true); App.showActivation(); });
  if (later) later.addEventListener('click', hide);
})();

// v7.1: cornice dell'avatar FISSA e verticale (9:16, come lo schermo del telefono), la più grande possibile nello spazio del palco.
// Nessuna trasformazione animata sul riquadro: solo dimensione e posizione calcolate a ogni ridimensionamento.
App.sizePortraitStage = function () {
  const st = document.getElementById('stage');
  if (!st || !document.body.classList.contains('solo-mode')) return;
  if (document.body.classList.contains('av-full-on') || st.classList.contains('av-full')) {
    st.style.height = '';
    st.style.maxHeight = '';
    st.style.flex = '';
    return;
  }
  const conv = document.getElementById('tab-conv');
  const img = App.avatarConv && App.avatarConv.img;
  const ar = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1.5;
  const w = Math.max(1, (conv && conv.clientWidth) || st.clientWidth);
  const vv = window.innerHeight || 800;
  if (conv && conv.classList.contains('stage-mini')) {
    const mh = Math.round(Math.min(vv * 0.22, w * ar));
    st.style.flex = '0 0 auto';
    st.style.height = mh + 'px';
    st.style.maxHeight = mh + 'px';
    return;
  }
  const form = document.getElementById('chat-form');
  const look = document.getElementById('look-bar');
  const formH = form ? form.offsetHeight : 48;
  const lookH = look && !look.hidden ? look.offsetHeight : 0;
  const shell = document.getElementById('app-shell');
  const limit = Math.min(vv, (shell && shell.clientHeight) || vv);
  const top = (document.querySelector('.topbar') && document.querySelector('.topbar').offsetHeight) || 0;
  const avail = conv && conv.clientHeight > 80 ? conv.clientHeight : Math.max(200, limit - top);
  const chatMin = 88;
  const maxH = Math.max(200, avail - formH - lookH - chatMin);
  const h = Math.round(Math.min(w * ar, maxH));
  st.style.flex = '0 0 auto';
  st.style.height = h + 'px';
  st.style.maxHeight = h + 'px';
};
App.fitFrame = function () {
  if (App.sizePortraitStage) App.sizePortraitStage();
  const st = document.getElementById('stage'), c = document.getElementById('avatar-canvas'); if (!st || !c) return;
  const cs = getComputedStyle(st);
  const W = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), H = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (W < 10 || H < 10) return;
  // v8.6.1: in solo (metà schermo e schermo intero) il canvas copre tutto il palco, bordo a bordo.
  // Il ritratto dentro è "cover" ancorato al viso (vedi TalkingAvatar.soloCover).
  if (document.body.classList.contains('solo-mode')) {
    const left = Math.round(parseFloat(cs.paddingLeft) || 0);
    const top = Math.round(parseFloat(cs.paddingTop) || 0);
    Object.assign(c.style, { width: Math.floor(W) + 'px', height: Math.floor(H) + 'px', left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto', transform: 'none', translate: 'none', aspectRatio: 'auto', maxWidth: 'none', maxHeight: 'none', borderRadius: '0', objectFit: 'fill', objectPosition: 'center center' });
    if (App.avatarConv && App.avatarConv.syncBackdrop) App.avatarConv.syncBackdrop(true);
    return;
  }
  let h = H, w = h * 9 / 16; if (w > W) { w = W; h = w * 16 / 9; }
  w = Math.floor(w); h = Math.floor(h);
  const left = Math.round(parseFloat(cs.paddingLeft) + (W - w) / 2);
  const top = Math.round(parseFloat(cs.paddingTop) + Math.max(0, (H - h) / 2));
  Object.assign(c.style, { width: w + 'px', height: h + 'px', left: left + 'px', top: top + 'px', transform: 'none', translate: 'none', aspectRatio: 'auto', maxWidth: 'none', borderRadius: st.classList.contains('av-full') ? '12px' : (document.body.classList.contains('solo-mode') ? '0' : '') });
  if (App.avatarConv && App.avatarConv.syncBackdrop) App.avatarConv.syncBackdrop(true);
};
(function () {
  const st = document.getElementById('stage'); if (!st) return;
  if (window.ResizeObserver) new ResizeObserver(() => App.fitFrame()).observe(st);
  addEventListener('resize', () => App.fitFrame()); addEventListener('orientationchange', () => setTimeout(App.fitFrame, 250));
  document.addEventListener('fullscreenchange', () => setTimeout(App.fitFrame, 50));
  App.fitFrame();
})();
// v8.6.6: la barra di Safari cambia l'altezza visibile; il dock e il composer restano sopra di essa.
// Con la tastiera iOS sposta la visual viewport (offsetTop > 0): la scocca segue quel rettangolo, senza far salire la pagina.
(function () {
  const apply = () => {
    const vv = window.__vvTest || window.visualViewport;
    if (!vv) return;
    document.documentElement.style.setProperty('--vv-top', Math.round(vv.offsetTop || 0) + 'px');
    document.documentElement.style.setProperty('--app-h', Math.round(vv.height) + 'px');
    const covered = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    document.documentElement.style.setProperty('--vv-bottom', Math.round(covered) + 'px');
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    const input = document.getElementById('chat-input');
    if (input && document.activeElement === input) {
      const m = document.getElementById('messages');
      if (m) m.scrollTop = m.scrollHeight;
    }
  };
  App.applyViewport = apply;
  apply();
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', apply);
    visualViewport.addEventListener('scroll', apply);
  }
  addEventListener('orientationchange', () => setTimeout(apply, 250));
  const input = document.getElementById('chat-input');
  if (input) input.addEventListener('focus', () => requestAnimationFrame(apply));
})();
