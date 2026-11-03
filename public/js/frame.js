'use strict';
// v8.4: «Adatta alla cornice» — se la foto dell'avatar è molto diversa dal 9:16, una sola volta l'IA la allarga (outpainting,
// stessa persona) e la versione adattata viene usata solo per la visualizzazione. Sempre annullabile («↩︎ Foto originale»).
// Finché non c'è, la cornice si riempie con un "cover" intelligente (≤12% per lato) e bande del colore dei bordi: mai sfocature.
(() => {
  const busy = {};
  const isPhoto = (s) => typeof s === 'string' && s.startsWith('/api/');
  const ratio = (src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im.naturalWidth / im.naturalHeight); im.onerror = () => r(0); im.src = src; });
  const far = (r) => !!r && (r < 0.43 || r > 0.74);
  const sync = (ch, ff) => { ch.frameFill = ff; const c = App.charById && App.charById(ch.id); if (c && c !== ch) c.frameFill = ff; if (App.current && App.current.id === ch.id) { App.current.frameFill = ff; App.avatarConv.setCharacter(App.current); } };
  async function landmarks(ch) {
    const ff = ch.frameFill; if (!ff || ff.landmarks || !App.autoFace || busy['lm' + ff.url]) return;
    busy['lm' + ff.url] = 1;
    try {
      const lm = await App.autoFace(ff.url); if (!lm) return;
      await App.api(`/api/characters/${ch.id}/frame-fill/landmarks`, { method: 'PUT', body: { url: ff.url, landmarks: lm } });
      sync(ch, { ...ff, landmarks: { ...lm, auto: true, src: ff.url } });
    } catch (e) { console.warn('frame landmarks', e); } finally { delete busy['lm' + ff.url]; }
  }
  async function extend(ch, auto, farShot) {
    if (!ch || busy[ch.id]) return null; busy[ch.id] = 1;
    try {
      if (!auto) App.toast(farShot ? '🔭 La allontano (stessa foto, ripresa più da lontano)… può richiedere qualche secondo' : '🖼️ Adatto la foto alla cornice 9:16…', 5000);
      const r = await App.api(`/api/characters/${ch.id}/frame-extend`, { method: 'POST', ai: true, body: farShot ? { far: true } : {} });
      sync(ch, r.frameFill); landmarks(ch);
      App.toast(auto ? '🖼️ Foto adattata alla cornice 9:16 (nell\'editor puoi tornare all\'originale)' : farShot ? '✅ Ora è più lontana (nell\'editor puoi tornare alla foto originale)' : '✅ Foto adattata alla cornice', 4500);
      return r.frameFill;
    } catch (e) { if (!auto) App.toast('⚠️ ' + e.message, 5000); return null; } finally { delete busy[ch.id]; }
  }
  async function setOff(ch, off) {
    const r = await App.api(`/api/characters/${ch.id}/frame-fill`, { method: 'PUT', body: { off } });
    sync(ch, r.frameFill); return r.frameFill;
  }
  // chiamata da TalkingAvatar.setCharacter (conversazione): punti del viso mancanti → rileva; foto molto fuori formato → una volta sola
  async function check(ch) {
    if (!ch || !ch.id || !isPhoto(ch.avatar)) return;
    const ff = ch.frameFill;
    if (ff && ff.src === ch.avatar) { if (!ff.off && !ff.landmarks) landmarks(ch); return; }
    if (!(App.isAdmin && App.isAdmin()) || !App.key() || navigator.webdriver) return;
    const tried = App.ls.get('frameTried', {}), k = ch.id + '|' + ch.avatar; if (tried[k]) return;
    if (!far(await ratio(ch.avatar))) return;
    tried[k] = Date.now(); App.ls.set('frameTried', tried);
    extend(ch, true);
  }
  App.frame = { check, extend, setOff, far, ratio };
})();
