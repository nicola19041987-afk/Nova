/* close.js — v8.6.5: X in alto a destra su ogni schermata e foglio, tranne Home/chat. */
(function () {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'layer-x';
  btn.className = 'layer-x';
  btn.setAttribute('aria-label', 'Chiudi');
  btn.title = 'Chiudi';
  btn.textContent = '✕';
  btn.hidden = true;
  document.body.appendChild(btn);

  const shown = (el) => el && !el.hidden;
  function openDialog() {
    const all = [...document.querySelectorAll('dialog')].filter((d) => d.open);
    return all.length ? all[all.length - 1] : null;
  }
  function openDetails() {
    return [...document.querySelectorAll('#view-app details[open]')].filter((d) => {
      const tab = d.closest('.tab');
      return !tab || !tab.hidden;
    });
  }
  function inApp() {
    const app = $('#view-app');
    return !!(app && !app.hidden);
  }
  function layer() {
    if (!inApp()) return null;
    const dlg = openDialog();
    if (dlg) return { kind: 'dialog', el: dlg };
    if (shown($('#sheet'))) return { kind: 'sheet' };
    if (shown($('#viewer'))) return { kind: 'viewer' };
    if (shown($('#presence'))) return { kind: 'presence' };
    if (App.call && App.call.active) return { kind: 'call' };
    const stage = $('#stage');
    if (stage && (stage.classList.contains('av-full') || stage.classList.contains('fs') || document.body.classList.contains('avatar-fs-on') || document.body.classList.contains('av-full-on'))) return { kind: 'fs' };
    const diag = $('#voice-diag-out');
    if (shown(diag)) return { kind: 'diag' };
    if (shown($('#act-menu'))) return { kind: 'menu', el: $('#act-menu') };
    if (shown($('#scene-menu'))) return { kind: 'menu', el: $('#scene-menu') };
    const details = openDetails();
    if (details.length) return { kind: 'details', el: details[details.length - 1] };
    const tabs = ['account', 'images', 'calls', 'feed', 'chat'];
    for (const name of tabs) {
      const el = document.getElementById('tab-' + name);
      if (shown(el)) return { kind: 'tab' };
    }
    return null;
  }
  function goHome() {
    if (App.solo && App.solo.onDock) App.solo.onDock('home');
    else if (App.openTab) App.openTab('chat');
  }
  function closeTop() {
    const cur = layer();
    if (!cur) return false;
    if (cur.kind === 'dialog') { cur.el.close(); return true; }
    if (cur.kind === 'sheet') { const c = $('#sheet-cancel'); if (c) c.click(); else $('#sheet').hidden = true; return true; }
    if (cur.kind === 'viewer') { const c = $('#vw-close'); if (c) c.click(); return true; }
    if (cur.kind === 'presence') { const c = $('#live-close'); if (c) c.click(); return true; }
    if (cur.kind === 'call') { const c = $('#call-end'); if (c) c.click(); return true; }
    if (cur.kind === 'fs') {
      const stage = $('#stage');
      if (stage && stage.classList.contains('av-full') && App.solo && App.solo.toggleFull) App.solo.toggleFull(false);
      else if (App.stageFs && App.stageFs.isFs && App.stageFs.isFs()) App.stageFs.exit();
      else if (stage) stage.classList.remove('fs', 'av-full');
      document.body.classList.remove('av-full-on', 'avatar-fs-on');
      return true;
    }
    if (cur.kind === 'diag') { $('#voice-diag-out').hidden = true; return true; }
    if (cur.kind === 'menu') { cur.el.hidden = true; return true; }
    if (cur.kind === 'details') { cur.el.open = false; return true; }
    if (cur.kind === 'tab') { goHome(); return true; }
    return false;
  }
  function place() {
    const cur = layer();
    btn.hidden = !cur;
    if (!cur) {
      if (btn.parentElement !== document.body) document.body.appendChild(btn);
      return;
    }
    if (cur.kind === 'dialog') {
      if (btn.parentElement !== cur.el) cur.el.appendChild(btn);
    } else if (btn.parentElement !== document.body) document.body.appendChild(btn);
  }
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeTop(); place(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !(t.closest && t.closest('dialog'))) return;
    if (!layer()) return;
    closeTop();
    place();
  });
  const mo = new MutationObserver(() => place());
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'], childList: true });
  document.addEventListener('visibilitychange', place);
  place();
  App.closeLayer = closeTop;
})();
