/* main.js — avvio, navigazione a schede, cambi automatici giornalieri, service worker. */
App.avatarConv = new TalkingAvatar($('#avatar-canvas'));
App.avatarEditor = new TalkingAvatar($('#editor-canvas'));

App.boot = async function () {
  try { App.me = await App.api('/api/me'); } catch { App.showLogin(); return; }
  if (!App.me.activated) return App.showActivation();
  if (App.me.consent) App.ls.set('consent', { activatedAt: App.me.consent.activatedAt });
  App.showView('app'); $('#who').textContent = App.me.name;
  App.opts = await App.api('/api/characters/options');
  await App.loadChars();
  App.editor.init(); App.voice.init();
  await App.account.load();
  App.chat.renderList();
  App.media.load().catch(() => {}); App.feed.load().catch(() => {});
  App.autoChanges();
};

// Cambi automatici: al primo avvio del giorno (o secondo la frequenza scelta), piccole variazioni plausibili
App.autoChanges = async function () {
  if (!App.key()) return;
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

const TITLES = { chat: 'Chat', feed: 'Diario', images: 'Immagini e video', account: 'Account' };
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tab;
  $$('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
  ['chat', 'conv', 'feed', 'images', 'account'].forEach((n) => { $(`#tab-${n}`).hidden = true; });
  if (t === 'chat' && App.current) { $('#tab-conv').hidden = false; $('#back-btn').hidden = false; $('#title').textContent = App.current.name; }
  else { $(`#tab-${t}`).hidden = false; $('#back-btn').hidden = true; $('#title').textContent = TITLES[t]; }
  if (t === 'feed') App.feed.load().catch(() => {});
}));

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
App.boot();
