/* Parametri di aspetto. Nessuna chiamata a un modello generativo: solo preset sul corpo già in app. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LookParse = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const REFUSAL = 'Non cambio l’aspetto: niente nudo, lingerie o enfasi sul corpo. Resta com’è.';
  const BAD = [
    /\bnud[oaie]?\b/i, /\bnaked\b/i, /\blingerie\b/i, /\bintim[oaie]\b/i, /\bperizoma\b/i, /\btanga\b/i,
    /\breggisen/i, /\bbikini\b/i, /\btopless\b/i, /\bmutand/i, /\bslip\b/i, /\bsexy\b/i, /\berotic/i,
    /\berotico\b/i, /\besplicit/i, /\bporno/i, /\bseno\b/i, /\btette\b/i, /\bgenital/i, /\bpene\b/i,
    /\bvagina\b/i, /\bscollat/i, /\bd[eé]col+et/i, /\bpush-?up\b/i, /\btrasparent/i, /\bunderwear\b/i,
    /\bnippl/i, /\bbreasts?\b/i, /\bboobs?\b/i, /\bcleavage\b/i, /\bspogliat/i, /\bstripp/i, /\bhot\b/i,
    /\bminorenn/i, /\bbambin[oa]\b/i, /\bragazzin[oa]\b/i, /\bteen\b/i, /\bloli/i, /\bschoolgirl\b/i,
  ];
  const COLORS = [
    ['nero', [22, 22, 24]], ['nera', [22, 22, 24]], ['neri', [22, 22, 24]],
    ['bianc', [232, 232, 232]], ['blu', [36, 74, 140]], ['ross', [156, 48, 48]],
    ['verd', [46, 110, 72]], ['grig', [128, 130, 134]], ['beige', [196, 176, 148]],
    ['marron', [92, 64, 44]], ['rosa', [214, 160, 168]],
  ];
  const DEFAULT = {
    gender: 'donna',
    hair: [198, 154, 88],
    eyes: [86, 122, 104],
    top: [22, 22, 24],
    bottom: [42, 78, 128],
    shoes: [28, 28, 30],
    height: 1,
    shoulders: 1,
    hips: 1,
    garmentTop: 'canotta',
    garmentBottom: 'jeans',
    summary: 'Donna · canotta nera · jeans blu · biondo miele',
  };
  const PRESET = {
    donna: DEFAULT,
    uomo: { gender: 'uomo', hair: [62, 46, 34], eyes: [92, 70, 48], top: [32, 48, 78], bottom: [40, 44, 52], shoes: [24, 24, 26], height: 1.02, shoulders: 1.04, hips: 1, garmentTop: 'camicia', garmentBottom: 'pantaloni', summary: 'Uomo · camicia blu · pantaloni scuri' },
    altro: { gender: 'altro', hair: [150, 124, 90], eyes: [90, 110, 100], top: [118, 122, 128], bottom: [52, 60, 74], shoes: [36, 36, 38], height: 1, shoulders: 1, hips: 1, garmentTop: 'maglia', garmentBottom: 'pantaloni', summary: 'Altro · maglia grigia · corporatura media' },
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function colorIn(s) { for (const [k, v] of COLORS) if (s.includes(k)) return v.slice(); return null; }
  function summary(look) {
    const g = look.gender === 'uomo' ? 'Uomo' : look.gender === 'altro' ? 'Altro' : 'Donna';
    return `${g} · ${look.garmentTop || 'maglia'} · ${look.garmentBottom || 'parte bassa'} · altezza ${look.height.toFixed(2)}`;
  }
  function refused(text) { return BAD.some((rx) => rx.test(text)); }
  function parse(text, base) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, error: 'Scrivi abbigliamento, genere o corpo.' };
    if (refused(raw)) return { ok: false, error: REFUSAL, refused: true };
    const look = clone(base && base.top ? base : DEFAULT);
    const low = raw.toLowerCase();
    const onlyGender = !/magli|maglion|canott|camic|felp|giacc|jeans|pantal|gonna|nero|blu|ross|verd|bianc|grig|beige|marron|rosa/.test(low);
    if (/\buomo\b|\bmaschio\b|\bmaschile\b/.test(low)) {
      if (onlyGender) Object.assign(look, clone(PRESET.uomo));
      else look.gender = 'uomo';
    } else if (/\bdonna\b|\bfemmin/.test(low)) {
      if (onlyGender) Object.assign(look, clone(PRESET.donna));
      else look.gender = 'donna';
    } else if (/\baltro\b|\bneutro\b|\bnon binari/.test(low)) {
      if (onlyGender) Object.assign(look, clone(PRESET.altro));
      else look.gender = 'altro';
    }
    if (/occhi\s+verdi|verdi\s+occhi|verdi\/grigi|occhi\s+grigi/.test(low)) look.eyes = [86, 122, 104];
    else if (/occhi\s+marroni|occhi\s+castani/.test(low)) look.eyes = [96, 68, 46];
    else if (/occhi\s+azzurr|occhi\s+blu/.test(low)) look.eyes = [70, 110, 150];
    if (/biond|miele/.test(low)) look.hair = [198, 154, 88];
    else if (/capelli\s+neri|capelli\s+scuri/.test(low)) look.hair = [42, 32, 28];
    else if (/capelli\s+castan|capelli\s+marron/.test(low)) look.hair = [96, 64, 40];
    else if (/capelli\s+ross/.test(low)) look.hair = [150, 72, 42];
    let rest = low.replace(/occhi\s+\w+/g, ' ').replace(/capelli\s+\w+(\s+\w+)?/g, ' ').replace(/biondo\s+miele/g, ' ');
    rest.split(/,| e | ed /).forEach((part) => {
      const col = colorIn(part);
      if (/canott|magliett|maglia|maglion|camic|felp|giacc|\btop\b/.test(part)) {
        if (col) look.top = col;
        look.garmentTop = /canott/.test(part) ? 'canotta' : /camic/.test(part) ? 'camicia' : /giacc/.test(part) ? 'giacca' : /felp/.test(part) ? 'felpa' : /maglion/.test(part) ? 'maglione' : 'maglia';
      } else if (/jeans|pantal|gonna|denim/.test(part)) {
        if (col) look.bottom = col;
        else if (/jeans|denim/.test(part)) look.bottom = [42, 78, 128];
        look.garmentBottom = /gonna/.test(part) ? 'gonna' : /jeans|denim/.test(part) ? 'jeans' : 'pantaloni';
      } else if (/scarp|stival/.test(part) && col) look.shoes = col;
    });
    if (/più alt|piu alt|slanciat|\balta\b|\balto\b/.test(low)) look.height = clamp((look.height || 1) + 0.02, 0.94, 1.06);
    if (/più bass|piu bass|\bbassa\b|\bbasso\b/.test(low)) look.height = clamp((look.height || 1) - 0.02, 0.94, 1.06);
    const hm = low.match(/altezza\s+(0?\.\d+|1(?:\.\d+)?)/);
    if (hm) look.height = clamp(parseFloat(hm[1]), 0.94, 1.06);
    if (/esile|minuta|sottil/.test(low)) {
      look.shoulders = clamp((look.shoulders || 1) - 0.02, 0.94, 1.06);
      look.hips = clamp((look.hips || 1) - 0.01, 0.96, 1.04);
    }
    if (/robust|spalle larg/.test(low)) look.shoulders = clamp((look.shoulders || 1) + 0.02, 0.94, 1.06);
    look.summary = summary(look);
    return { ok: true, look, summary: look.summary };
  }
  return { DEFAULT, PRESET, parse, refused, REFUSAL };
});
