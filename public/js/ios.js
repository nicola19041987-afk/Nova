/* ios.js — v8.4 aspetto iPhone: schermata Home (orologio, icone, dock), barra di stato finta (solo nel browser),
 * titoli grandi, foglio azioni, scheda Chiamate e permessi (Nicola amministratore, Luisa utente). */
(function () {
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const pad = (n) => String(n).padStart(2, '0');
  // ---------- barra di stato ----------
  function statusBar() {
    const on = false; document.body.classList.remove('sb-on'); // v8.5.0: niente barra di stato finta (stile WhatsApp, senza telefono)
    return; // nell'app installata si vede quella vera di iOS
    const tick = () => {
      const d = new Date(); $('#sb-time').textContent = `${d.getHours()}:${pad(d.getMinutes())}`;
      $('#sb-wifi').classList.toggle('off', !navigator.onLine);
      if ($('#home') && !$('#home').hidden) clock();
    };
    tick(); setInterval(tick, 1000 * 5); addEventListener('online', tick); addEventListener('offline', tick);
    const lvl = $('#sb-batt-lvl'); lvl.style.width = '100%';
    if (navigator.getBattery) navigator.getBattery().then((b) => {
      const upd = () => { lvl.style.width = Math.max(8, Math.round(b.level * 100)) + '%'; lvl.classList.toggle('low', b.level < 0.2 && !b.charging); lvl.classList.toggle('chg', b.charging); };
      upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
    }).catch(() => {});
  }
  // ---------- Home ----------
  const DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  function clock() {
    const d = new Date();
    $('#wc-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('#wc-date').textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    const h = d.getHours(), who = App.me ? App.me.name : '';
    $('#wc-sub').textContent = (h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera') + (who ? `, ${who}` : '');
  }
  App.home = {
    show() { if (App.openTab) App.openTab('chat'); }, // v8.5.0: Home finta rimossa
    hide() { const h = $('#home'); if (!h || h.hidden) return; h.hidden = true; document.body.classList.remove('home-on'); },
    // all'avvio si parte dalla Home (i test automatici partono direttamente da Chat)
    boot() { /* v8.5.0: niente Home finta, si parte direttamente dalle Chat */ },
  };
  $('#home').addEventListener('click', (e) => {
    const b = e.target.closest('.app-ic'); if (!b) return;
    if (b.dataset.deco) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; } // icone decorative: non si aprono
    const t = b.dataset.open;
    if (t === 'grok') { window.open('https://grok.com', '_blank', 'noopener'); return; }
    if (t === 'create') { App.openTab('images'); App.gallery && App.gallery.seg('create'); return; }
    App.openTab(t);
  });
  $('#home-link').addEventListener('click', () => App.home.show());
  $('#home-ind').addEventListener('click', () => { if (App.call && App.call.active) return; App.home.show(); });
  // ---------- titolo grande: il titolo piccolo compare solo scorrendo (come iOS) ----------
  if (window.IntersectionObserver) new IntersectionObserver(([en]) => document.body.classList.toggle('lt-gone', !en.isIntersecting), { rootMargin: '-60px 0px 0px 0px' }).observe($('#large-title'));
  // ---------- foglio azioni ----------
  App.sheet = function (title, actions) {
    return new Promise((res) => {
      const sh = $('#sheet'), body = $('#sheet-body');
      body.innerHTML = (title ? `<p class="sheet-title">${esc(title)}</p>` : '') + actions.map((a, i) => `<button type="button" data-i="${i}" class="${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`).join('');
      sh.hidden = false;
      const done = (v) => { sh.hidden = true; sh.onclick = null; res(v); };
      sh.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) return done(actions[+b.dataset.i].value); if (e.target === sh || e.target.id === 'sheet-cancel') done(null); };
    });
  };
  // ---------- Chiamate ----------
  const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? (s % 60) + ' s' : ''}` : `${s} s`);
  const fmtWhen = (iso) => {
    const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === y.toDateString()) return 'Ieri';
    if (now - d < 6 * 864e5) return DAYS[d.getDay()];
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  let calls = [], filt = 'all';
  App.calls = {
    async load() { try { calls = (await App.api('/api/calls')).calls || []; } catch { calls = []; } this.render(); },
    render() {
      const list = calls.filter((c) => filt === 'all' || c.mode === filt), ul = $('#calls-list');
      ul.innerHTML = list.map((c) => {
        const ch = App.charById(c.characterId); if (!ch) return '';
        return `<li data-c="${esc(c.characterId)}" data-m="${c.mode}">${App.avatarHtml(ch, 'avatar sm')}<div class="grow"><b>${esc(ch.name)}</b><span>${c.mode === 'voice' ? '📞 Vocale' : '📹 Video'} · ${esc(fmtDur(c.seconds || 0))}</span></div><time>${esc(fmtWhen(c.startedAt))}</time><button type="button" class="ic-btn" aria-label="Richiama">${c.mode === 'voice' ? '📞' : '📹'}</button></li>`;
      }).join('') || '<li class="empty muted">Nessuna chiamata recente. Apri una chat e tocca 📞 o 📹.</li>';
    },
  };
  $('#calls-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; filt = b.dataset.f; $$('#calls-seg button').forEach((x) => x.classList.toggle('on', x === b)); App.calls.render(); });
  $('#calls-list').addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-c]'); if (!li) return;
    App.audio.unlock(); // dentro il tocco (iPhone)
    await App.chat.open(li.dataset.c);
    App.call.start(li.dataset.m === 'voice' ? 'voice' : 'video');
  });
  // ---------- permessi: Nicola amministratore, Luisa utente ----------
  const NOTE = 'Serve un accesso per modificare questa parte';
  App.isAdmin = () => !!(App.me && App.me.admin);
  App.canEdit = () => !!(App.me && (App.me.admin || App.me.editor)); // v8.5.2: Luisa modifica i personaggi
  App.roles = {
    apply() {
      const admin = App.isAdmin(); document.body.classList.toggle('not-admin', !admin); document.body.classList.toggle('no-edit', !App.canEdit());
      $('#admin-note-chars').hidden = App.canEdit();
      const lock = (sel, keep = []) => {
        const el = $(sel); if (!el) return; const card = el.closest('.card') || el.parentElement;
        card.classList.toggle('locked', !admin);
        card.querySelectorAll('input,textarea,select,button').forEach((x) => { if (keep.some((k) => x.matches(k))) return; if (!admin) { x.dataset.lockWas = x.disabled ? '1' : ''; x.disabled = true; } else if (x.dataset.lockWas !== undefined) { x.disabled = x.dataset.lockWas === '1'; delete x.dataset.lockWas; } });
        let n = card.querySelector('.lock-note'); if (!admin && !n) { n = document.createElement('p'); n.className = 'lock-note'; n.textContent = '🔒 ' + NOTE; card.querySelector('h3') ? card.querySelector('h3').after(n) : card.prepend(n); } if (admin && n) n.remove();
      };
      lock('#rules-input'); lock('#set-video-model');
      ['#set-autosave', '#set-export'].forEach((s) => { const x = $(s); if (x) { x.disabled = !admin; x.closest('label').classList.toggle('locked-row', !admin); x.closest('label').title = admin ? '' : NOTE; } });
      ['#recovery-scan', '#wipe-btn'].forEach((s) => { const c = $(s) && $(s).closest('.card'); if (c) c.hidden = !admin; });
    },
    guard(msg) { if (App.canEdit()) return true; App.toast('🔒 ' + NOTE + (msg ? ': ' + msg : ''), 3500); return false; },
  };
  statusBar();
})();
