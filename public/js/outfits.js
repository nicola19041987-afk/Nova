/* outfits.js — v2d-33: Nova si cambia da sola vestito, acconciatura e trucco.
   Ogni look (ch.outfits) ha la sua foto (stesso viso, stessa inquadratura), i suoi punti del viso per il labiale e i suoi clip
   di movimento (clip.outfit = chiave del look). Il look cambia da solo con l'ora del giorno (mattina sportiva, primo pomeriggio
   elegante, pomeriggio comoda, sera elegante o sexy) e si può chiedere in chat («mettiti qualcosa di sportivo»).
   La scelta resta su questo telefono (localStorage); senza look caricati tutto resta come prima (foto di base). */
(function (root) {
  const TOKEN = /^[a-z_]{1,24}$/;
  const AV = /^\/api\/avatars\/[a-f0-9]{16}\.(png|jpg)$/;
  const STYLES = ['sportiva', 'comoda', 'elegante', 'sexy'];
  const HOLD_MS = 3 * 3600e3; // un look chiesto in chat resta per 3 ore, poi torna la scelta automatica
  const STYLE_WORDS = {
    sportiva: /sportiv|\btuta\b|palestra|ginnastica|leggings|allenament|\bcorsa\b|\bfitness\b|\bjogging\b/,
    comoda: /comod|\bfelpa\b|maglion|pigiama|\brelax\b|da casa|casual|rilassat/,
    elegante: /elegant|camicett|da sera|serata|\bchic\b|raffinat|\bgala\b|\bclassic/,
    sexy: /\bsexy\b|sensual|seducent|tubino|\braso\b|provocant|intrigant|\bsatin\b|attillat/,
  };
  // «mettiti / indossa / vestiti / cambiati / fatti…»: la richiesta deve essere rivolta a lei, non una frase qualsiasi con «comodo»
  const ASK = /\b(mett\w*|indoss\w*|vestit[io]\b|vestiti|cambiat[ie]|cambia\w*|prov[ai]\w*|fatti|sistemati|ti va di mett\w*)\b/;
  const ANY = /\b(cambia(ti)?|un altro|altro|diverso|nuovo)\s+(look|vestito|abito|outfit|stile)\b|\bcambiati\b|\bcambia look\b/;

  function list(ch) {
    const out = [];
    for (const o of (ch && Array.isArray(ch.outfits) ? ch.outfits : [])) {
      if (!o || !TOKEN.test(String(o.key || '')) || !AV.test(String(o.avatar || ''))) continue;
      out.push({ key: o.key, style: STYLES.includes(o.style) ? o.style : 'comoda', label: String(o.label || o.key).slice(0, 80), avatar: o.avatar, landmarks: o.landmarks || null, words: Array.isArray(o.words) ? o.words.filter((w) => /^[a-zà-ù]{3,20}$/.test(w)) : [] });
    }
    return out;
  }
  function hasClips(ch, key) { return !!(ch && Array.isArray(ch.motionClips) && ch.motionClips.some((c) => c && c.outfit === key)); }
  // fascia oraria -> stile. La sera alterna elegante e sexy a giorni.
  function slotOf(d) {
    const h = d.getHours(), day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 864e5);
    if (h >= 6 && h < 11) return { style: 'sportiva', id: day + ':m' };
    if (h >= 11 && h < 15) return { style: 'elegante', id: day + ':g' };
    if (h >= 15 && h < 19) return { style: 'comoda', id: day + ':p' };
    if (h >= 19) return { style: day % 2 ? 'sexy' : 'elegante', id: day + ':s' };
    return { style: 'comoda', id: day + ':n' };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // scelta automatica stabile per tutta la fascia (stesso look se riapri l'app), diversa nei vari giorni
  function autoPick(ch, d) {
    const L = list(ch); if (!L.length) return null;
    const s = slotOf(d);
    let pool = L.filter((o) => o.style === s.style);
    const withClips = pool.filter((o) => hasClips(ch, o.key)); if (withClips.length) pool = withClips;
    if (!pool.length) pool = L;
    return { key: pool[hash(s.id + ch.id) % pool.length].key, slot: s.id, by: 'auto' };
  }
  function storeKey(ch) { return 'outfit:' + ch.id; }
  function load(ch) { try { return (root.App && App.ls) ? App.ls.get(storeKey(ch), null) : null; } catch { return null; } }
  function save(ch, v) { try { if (root.App && App.ls) App.ls.set(storeKey(ch), v); } catch { /* */ } }
  // look attuale (oggetto della lista) o null = foto di base
  function current(ch, now) {
    const L = list(ch); if (!L.length) return null;
    const d = now ? new Date(now) : new Date();
    const st = load(ch);
    if (st && st.by === 'chat' && st.until > d.getTime()) { const o = L.find((x) => x.key === st.key); if (o) return o; }
    if (st && st.by === 'base' && st.until > d.getTime()) return null;
    const a = autoPick(ch, d);
    if (!st || st.by !== 'auto' || st.slot !== a.slot || !L.some((x) => x.key === st.key)) save(ch, a);
    const k = (st && st.by === 'auto' && st.slot === a.slot && L.some((x) => x.key === st.key)) ? st.key : a.key;
    return L.find((x) => x.key === k) || null;
  }
  function key(ch) { const o = current(ch); return o ? o.key : ''; }
  // testo di chi scrive -> look richiesto (o null). Riconosce anche le parole dei singoli look (felpa, tubino, coda…).
  function fromText(ch, text) {
    const t = String(text || '').toLowerCase().trim();
    const L = list(ch);
    if (!t || !L.length || /^\s*(sistema|segna|segnala)\b/.test(t)) return null; // comandi per l'app / Blocco note: non sono vestiti
    const ask = ASK.test(t);
    if (!ask && !ANY.test(t)) return null;
    for (const o of L) if (o.words.some((w) => new RegExp('\\b' + w).test(t))) return { outfit: o, why: 'parola' };
    for (const s of STYLES) if (STYLE_WORDS[s].test(t)) {
      const pool = L.filter((o) => o.style === s); if (!pool.length) continue;
      const cur = current(ch); const other = pool.filter((o) => !cur || o.key !== cur.key);
      const pickFrom = other.length ? other : pool;
      return { outfit: pickFrom[Math.floor(Math.random() * pickFrom.length)], why: s };
    }
    if (ANY.test(t)) { const cur = current(ch); const other = L.filter((o) => !cur || o.key !== cur.key); if (other.length) return { outfit: other[Math.floor(Math.random() * other.length)], why: 'altro' }; }
    return null;
  }
  const api = { STYLES, list, slotOf, autoPick, current, key, fromText, HOLD_MS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.Outfits = api;
  if (!root.App) return;
  const App = root.App;
  App.outfits = {
    current: (ch) => current(ch),
    key: (ch) => key(ch),
    // cambia look: chiave, o '' per la foto di base. Aggiorna foto, labiale e movimento.
    set(ch, k, by = 'chat') {
      if (!ch) return false;
      const L = list(ch);
      if (k && !L.some((o) => o.key === k)) return false;
      save(ch, k ? { key: k, by, until: Date.now() + HOLD_MS } : { key: '', by: 'base', until: Date.now() + HOLD_MS });
      this.apply(true);
      return true;
    },
    // chiamato prima di mandare un messaggio: se è una richiesta di vestiti, lei si cambia. Ritorna il look nuovo o null.
    hear(ch, text) {
      const r = fromText(ch, text); if (!r) return null;
      this.set(ch, r.outfit.key, 'chat');
      return r.outfit;
    },
    // ridisegna foto + labiale + clip se il look è cambiato (anche per l'ora del giorno)
    apply(force) {
      const ch = App.current; if (!ch) return;
      const k = ch.id + '|' + key(ch);
      if (!force && this._applied === k) return;
      const first = this._applied === undefined; this._applied = k;
      if (first && !force) return; // all'avvio l'app disegna già il look giusto (faceSrc / faceLm)
      try { if (App.motionPlayer && App.motionPlayer.on) App.motionPlayer.stop(); } catch { /* */ }
      try { if (App.avatarConv && App.avatarConv.setCharacter) App.avatarConv.setCharacter(ch); } catch { /* */ }
      try { if (App.chat && App.chat.header) App.chat.header(); } catch { /* */ }
      try { const slot = document.getElementById('nh-avatar'); if (slot && App.paintAvatar) App.paintAvatar(slot, ch, 'nh-avatar-face'); } catch { /* */ }
      try { if (App.solo && App.solo.syncChar) App.solo.syncChar(); } catch { /* */ }
    },
  };
  // la foto mostrata (avatar, intestazione, poster dei video) è quella del look attuale
  const baseFace = App.faceSrc;
  App.faceSrc = (ch) => { const o = ch && current(ch); return o ? o.avatar : baseFace(ch); };
  // punti del viso per il labiale: quelli misurati su questa foto; altrimenti quelli della base (non validi per il warp:
  // il riconoscimento del viso li misura sul telefono e li salva sul look con App.faceFound)
  App.faceLm = (ch) => { const o = ch && current(ch); return o && o.landmarks && o.landmarks.eyeL ? o.landmarks : (ch && ch.landmarks); };
  // controllo leggero: al cambio di fascia oraria il look cambia da solo
  setInterval(() => { try { if (document.visibilityState === 'visible') App.outfits.apply(false); } catch { /* */ } }, 60000);
})(typeof window !== 'undefined' ? window : globalThis);
