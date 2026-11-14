/* outfits.js — v2d-33: guardaroba di Nova (ogni look: foto, punti del viso per il labiale, clip con clip.outfit = chiave).
   v2d-35: niente più cambio automatico con l'ora del giorno. I vestiti cambiano SOLO su richiesta («più elegante», «copriti»,
   «mettiti la felpa»). L'unica variazione automatica è la SCENA (style «scena»: in macchina, al parco, a tavola…): una a
   sorpresa per ogni visita (dopo 45 minuti di assenza), mai durante una frase, e solo tra le scene che hanno i loro clip.
   La scelta resta su questo telefono (localStorage); senza look caricati tutto resta come prima (foto di base). */
(function (root) {
  const TOKEN = /^[a-z_]{1,24}$/;
  const AV = /^\/api\/avatars\/[a-f0-9]{16}\.(png|jpg)$/;
  const STYLES = ['sportiva', 'comoda', 'elegante', 'sexy', 'coperta', 'costume', 'scena', 'capelli']; // v2d-36: «capelli» = variante chiesta per parola (capelli neri)
  const ASKABLE = ['coperta', 'elegante', 'comoda', 'sportiva', 'sexy', 'costume']; // ordine: «copriti» prima di «comoda»
  const HOLD_MS = 3 * 3600e3; // un look chiesto resta per 3 ore (o finché si chiede altro), poi torna la scena della visita
  // v2d-36: Nova cambia anche DA SOLA (look o capelli): a volte a una nuova visita, raramente a metà chiamata in un
  // momento tranquillo (mai mentre parla), al massimo una volta per sessione e non prima di 20 minuti dall'ultimo cambio.
  const SPONT_VISIT = 0.35, SPONT_MID = 0.12, SPONT_GAP_MS = 20 * 60e3;
  const spont = { on: true, rand: () => Math.random() }; // dado separato dalla scelta della scena (le prove lo fissano)
  const roll = () => (spont.on ? spont.rand() : 1);
  const VISIT_GAP_MS = 45 * 60e3; // dopo 45 minuti senza app aperta è una nuova visita: nuova scena a sorpresa
  const STYLE_WORDS = {
    coperta: /\bcopri(ti|rti|tevi)?\b|\bcoperta\b|più coperta|piu coperta|\bdolcevita\b|collo alto|meno scollat|\bvestita di più\b/,
    sportiva: /sportiv|\btuta\b|palestra|ginnastica|leggings|allenament|\bcorsa\b|\bfitness\b|\bjogging\b/,
    comoda: /comod|\bfelpa\b|maglion|pigiama|\brelax\b|da casa|casual|rilassat/,
    elegante: /elegant|camicett|da sera|serata|\bchic\b|raffinat|\bgala\b|\bclassic/,
    sexy: /\bsexy\b|sensual|seducent|tubino|\braso\b|provocant|intrigant|\bsatin\b|attillat/,
    costume: /infermier|\bcamice\b|travestiment|\bcostume da\b/,
  };
  // «mettiti / indossa / vestiti / cambiati / copriti / più elegante…»: la richiesta deve essere rivolta a lei
  const ASK = /\b(fammi\s+vedere|farmi\s+vedere|come\s+staresti|mett\w*|indoss\w*|vestit[io]\b|vestiti|cambiat[ie]|cambia\w*|prov[ai]\w*|fatti|sistemati|ti va di mett\w*|copri(ti|rti)?|travestit\w*)\b|\b(più|piu)\s+(elegante|sportiva|comoda|coperta|sexy|carina|semplice)\b/;
  const ANY = /\b(cambia(ti)?|un altro|altro|diverso|nuovo)\s+(look|vestito|abito|outfit|stile)\b|\bcambiati\b|\bcambia look\b/;
  const BACK = /\b(torna|rimettiti)\s+(come prima|normale|quella di prima|al solito)\b|\bcome eri prima\b|\bvestita come prima\b/;

  function list(ch) {
    const out = [];
    for (const o of (ch && Array.isArray(ch.outfits) ? ch.outfits : [])) {
      if (!o || !TOKEN.test(String(o.key || '')) || !AV.test(String(o.avatar || ''))) continue;
      if (o.disabled) continue; // v2d-36: look ritirati (es. ospedale: Nova non ha un lavoro) restano sul server ma non si usano
      out.push({ key: o.key, style: STYLES.includes(o.style) ? o.style : 'comoda', label: String(o.label || o.key).slice(0, 80), avatar: o.avatar, landmarks: o.landmarks || null, disabled: !!o.disabled, words: Array.isArray(o.words) ? o.words.filter((w) => /^[a-zà-ù]{3,20}$/.test(w)) : [] });
    }
    return out;
  }
  function hasClips(ch, key) { return !!(ch && Array.isArray(ch.motionClips) && ch.motionClips.some((c) => c && c.outfit === key)); }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // scene a sorpresa: solo quelle con i loro clip (così si muove sempre); se nessuna ha clip, nessuna scena (foto di base)
  function scenes(ch) { return list(ch).filter((o) => o.style === 'scena' && hasClips(ch, o.key)); }
  // nuova scena per una nuova visita: diversa dall'ultima, casuale ma riproducibile in prova (rand)
  function pickScene(ch, prevKey, rand) {
    const S = scenes(ch); if (!S.length) return null;
    const pool = S.length > 1 ? S.filter((o) => o.key !== prevKey) : S;
    const r = typeof rand === 'function' ? rand() : Math.random();
    return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))].key;
  }
  // look che può scegliersi da sola: vestiti/capelli che si muovono (con clip), non scene né ritirati
  function ownPicks(ch) { return list(ch).filter((o) => o.style !== 'scena' && o.style !== 'costume' && hasClips(ch, o.key)); }
  function pickOwn(ch, curKey, rand) {
    const P = ownPicks(ch).filter((o) => o.key !== curKey); if (!P.length) return null;
    const r = typeof rand === 'function' ? rand() : Math.random();
    return P[Math.min(P.length - 1, Math.floor(r * P.length))].key;
  }
  function storeKey(ch) { return 'outfit:' + ch.id; }
  function load(ch) { try { return (root.App && root.App.ls) ? root.App.ls.get(storeKey(ch), null) : null; } catch { return null; } }
  function save(ch, v) { try { if (root.App && root.App.ls) root.App.ls.set(storeKey(ch), v); } catch { /* */ } }
  // stato salvato: { scene, seen, key?, by?: 'chat'|'base', until? }. Il vecchio stato v2d-33 ({by:'auto', slot}) si ignora.
  function state(ch, t, rand) {
    let st = load(ch); if (!st || typeof st !== 'object' || st.by === 'auto' || st.slot) st = { scene: '', seen: 0 };
    const S = scenes(ch);
    const newVisit = !st.seen || t - st.seen > VISIT_GAP_MS || (st.scene && !S.some((o) => o.key === st.scene)) || (!st.scene && S.length);
    if (newVisit) {
      st = { ...st, scene: pickScene(ch, st.scene, rand) || '', visitAt: t };
      if ((st.by === 'chat' || st.by === 'lei') && !(st.until > t)) { delete st.by; delete st.key; delete st.until; }
      // v2d-36: a volte, tra una visita e l'altra, si è cambiata da sola (solo se nessuno le ha chiesto un look ancora valido)
      if (st.by !== 'chat' && st.by !== 'base' && roll() < SPONT_VISIT) { const k = pickOwn(ch, st.key, spont.rand); if (k) Object.assign(st, { key: k, by: 'lei', until: t + HOLD_MS, spontAt: t, told: false }); }
    }
    if (newVisit || t - (st.seen || 0) > 60e3) { st.seen = t; save(ch, st); }
    return st;
  }
  // look attuale (oggetto della lista) o null = foto di base
  function current(ch, now, rand) {
    const L = list(ch); if (!L.length) return null;
    const t = now ? new Date(now).getTime() : Date.now();
    const st = state(ch, t, rand);
    if ((st.by === 'chat' || st.by === 'lei') && st.until > t) { const o = L.find((x) => x.key === st.key); if (o) return o; }
    if (st.by === 'base' && st.until > t) return null;
    return L.find((x) => x.key === st.scene) || null;
  }
  function key(ch) { const o = current(ch); return o ? o.key : ''; }
  // testo di chi scrive -> look richiesto (o null). Riconosce anche le parole dei singoli look (felpa, tubino, coda…).
  function fromText(ch, text) {
    const t = String(text || '').toLowerCase().trim();
    const L = list(ch);
    if (!t || !L.length || /^\s*(sistema|segna|segnala)\b/.test(t)) return null; // comandi per l'app / Blocco note: non sono vestiti
    if (BACK.test(t)) return { outfit: null, why: 'come-prima' };
    const ask = ASK.test(t);
    if (!ask && !ANY.test(t)) return null;
    const wearable = L.filter((o) => o.style !== 'scena');
    for (const o of wearable) if (o.words.some((w) => new RegExp('\\b' + w).test(t))) return { outfit: o, why: 'parola' };
    const cur = current(ch);
    for (const s of ASKABLE) if (STYLE_WORDS[s].test(t)) {
      let pool = wearable.filter((o) => o.style === s);
      if (!pool.length && s === 'coperta') pool = wearable.filter((o) => o.style === 'comoda'); // «copriti» senza look coperto: il più comodo
      if (!pool.length) continue;
      const moving = pool.filter((o) => hasClips(ch, o.key)); if (moving.length) pool = moving; // prima i look che si muovono
      const newer = pool.filter((o) => /^nova_/.test(o.key)); if (newer.length) pool = newer; // v2d-35: prima i look nuovi (frangia, inquadratura all'ombelico)
      const other = pool.filter((o) => !cur || o.key !== cur.key);
      const pickFrom = other.length ? other : pool;
      return { outfit: pickFrom[Math.floor(Math.random() * pickFrom.length)], why: s };
    }
    if (ANY.test(t)) { const other = wearable.filter((o) => (!cur || o.key !== cur.key) && hasClips(ch, o.key)); if (other.length) return { outfit: other[Math.floor(Math.random() * other.length)], why: 'altro' }; }
    return null;
  }
  // v2d-36: a metà chiamata/chat, in un momento tranquillo: si cambia da sola? (puro: decide, non applica)
  function midChange(ch, t, rand, ctx) {
    const c = ctx || {};
    if (c.speaking || c.busy || c.done || c.guest) return null; // mai mentre parla o risponde; una volta per sessione
    const st = state(ch, t, rand);
    if (st.by === 'chat' && st.until > t) return null; // un look chiesto da lui si rispetta
    const last = Math.max(st.spontAt || 0, st.visitAt || 0, st.changedAt || 0);
    if (t - last < SPONT_GAP_MS) return null;
    if (roll() >= SPONT_MID) return null;
    const cur = current(ch, t, rand);
    return pickOwn(ch, cur ? cur.key : '', spont.rand);
  }
  const api = { STYLES, list, ownPicks, midChange, spont, SPONT_VISIT, SPONT_MID, SPONT_GAP_MS, scenes, pickScene, current, key, fromText, HOLD_MS, VISIT_GAP_MS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.Outfits = api;
  if (!root.App) return;
  const App = root.App;
  // v2d-36: nelle prove automatiche (webdriver) il cambio spontaneo è spento, salvo ls 'spontLook' = '1'; '0' lo spegne sempre
  try { const f = App.ls ? App.ls.get('spontLook', null) : null; spont.on = f === '1' || (f !== '0' && !(root.navigator && root.navigator.webdriver)); } catch { /* */ }
  App.outfits = {
    current: (ch) => current(ch),
    key: (ch) => key(ch),
    // cambia look: chiave, o '' per la foto di base. Aggiorna foto, labiale e movimento.
    set(ch, k, by = 'chat') {
      if (!ch) return false;
      const L = list(ch);
      if (k && !L.some((o) => o.key === k)) return false;
      const st = state(ch, Date.now());
      if (k) Object.assign(st, { key: k, by, until: Date.now() + HOLD_MS, changedAt: Date.now() }, by === 'lei' ? { spontAt: Date.now(), told: false } : { told: true });
      else if (by === 'scena') { delete st.key; delete st.by; delete st.until; } // «torna come prima»: la scena della visita
      else Object.assign(st, { key: '', by: 'base', until: Date.now() + HOLD_MS });
      save(ch, st);
      this.apply(true);
      return true;
    },
    // chiamato prima di mandare un messaggio: se è una richiesta di vestiti, lei si cambia. Ritorna il look nuovo o null.
    hear(ch, text) {
      const r = fromText(ch, text); if (!r) return null;
      if (!r.outfit) { this.set(ch, '', 'scena'); return current(ch) || { key: '', label: 'come prima' }; }
      this.set(ch, r.outfit.key, 'chat');
      return r.outfit;
    },
    // v2d-36: si è cambiata da sola e non l'ha ancora detto? -> 'lei' (il server le fa accennare «ho voluto cambiare…»)
    pendingNote(ch) { const st = ch && load(ch); return !!(st && st.by === 'lei' && st.told === false && st.until > Date.now()); },
    told(ch) { const st = ch && load(ch); if (st && st.by === 'lei' && st.told === false) { st.told = true; save(ch, st); } },
    // v2d-36: momento tranquillo (dopo una sua risposta): ogni tanto si cambia da sola. Ritorna il look nuovo o null.
    maybeSpontaneous(ch, rand) {
      if (!ch || ch.role === 'support') return null;
      const sp = (App.avatarConv && App.avatarConv.speaking) || (App.voice && App.voice.speaking);
      const k = midChange(ch, Date.now(), rand, { speaking: !!sp, busy: !!(App.chat && App.chat.busy), done: this._midDone === ch.id, guest: !!(App.me && App.me.guest) });
      if (!k) return null;
      this._midDone = ch.id;
      this.set(ch, k, 'lei');
      return list(ch).find((o) => o.key === k) || null;
    },
    // ridisegna foto + labiale + clip se il look è cambiato (richiesta o nuova visita). Mai mentre parla o risponde.
    apply(force) {
      const ch = App.current; if (!ch) return;
      if (!force && ((App.avatarConv && App.avatarConv.speaking) || (App.chat && App.chat.busy) || (App.call && App.call.active))) return;
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
  // v2d-36: un look senza punti propri NON usa quelli della foto di base (bocca disegnata nel posto sbagliato): null ->
  // punti «incerti», niente bocca disegnata, e il riconoscimento del viso li misura su questa foto
  App.faceLm = (ch) => { const o = ch && current(ch); if (o) return o.landmarks && o.landmarks.eyeL ? o.landmarks : null; return ch && ch.landmarks; };
  // controllo leggero: dopo una lunga assenza (nuova visita) la scena cambia; mai a metà conversazione
  setInterval(() => { try { if (document.visibilityState === 'visible') App.outfits.apply(false); } catch { /* */ } }, 60000);
})(typeof window !== 'undefined' ? window : globalThis);
