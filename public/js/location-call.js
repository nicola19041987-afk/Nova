/* location-call.js — in videochiamata Ira si vede già nel luogo da cui si collega
 * (showroom, più avanti casa e palestra). 2D, clip muti, nessuna scritta sul video.
 * La voce resta solo quella in tempo reale. La foto della chat non si tocca.
 * I clip sono Ira già nella scena: mai un ritaglio sulla foto di sfondo.
 */
(function () {
  const HOME = 'petto';
  const LS_LAST = 'locationLast';
  const LS_FORCE = 'locationForce'; // solo prova tecnica; vuoto = scelta naturale
  let index = { default: 'showroom', pick: 'natural', places: [] };
  let packs = {}; // id -> { still, clips:[{id,url,kind,from,to,label,weight}] }
  let current = null; // place id for THIS call
  let loaded = false;

  const readyPlaces = () => (index.places || []).filter((p) => p.ready && packs[p.id] && packs[p.id].clips && packs[p.id].clips.length);
  const inVideoCall = () => {
    const body = document.body.classList;
    const stage = document.getElementById('stage');
    if (!body.contains('in-call') || body.contains('call-min')) return false;
    if (stage && stage.classList.contains('voice')) return false;
    return !!(App.call && App.call.active && App.call.mode !== 'voice');
  };

  function naturalPick(ready) {
    if (!ready.length) return null;
    if (ready.length === 1) return ready[0].id;
    const force = App.ls ? App.ls.get(LS_FORCE, '') : '';
    if (force && ready.some((p) => p.id === force)) return force;
    const hour = new Date().getHours(); // fuso della macchina / utente
    const weight = (id) => {
      // orari tipici, non rigidi: lei lavora allo showroom ma può collegarsi da dove si trova
      if (id === 'showroom') return (hour >= 9 && hour < 19) ? 3.2 : 1.1;
      if (id === 'cucina') return (hour >= 7 && hour < 10) || (hour >= 12 && hour < 14) || (hour >= 19 && hour < 21) ? 2.2 : 0.8;
      if (id === 'palestra') return (hour >= 7 && hour < 10) || (hour >= 17 && hour < 21) ? 2.0 : 0.6;
      if (id === 'salotto') return (hour >= 18 || hour < 8) ? 2.4 : 1.0;
      if (id === 'camera') return (hour >= 21 || hour < 8) ? 2.2 : 0.5;
      return 1;
    };
    const last = App.ls ? App.ls.get(LS_LAST, '') : '';
    const pool = ready.map((p) => ({ id: p.id, w: weight(p.id) * (p.id === last && ready.length > 1 ? 0.35 : 1) }));
    const sum = pool.reduce((s, x) => s + x.w, 0) || 1;
    let r = Math.random() * sum;
    for (const x of pool) { r -= x.w; if (r <= 0) return x.id; }
    return pool[0].id;
  }

  function libOf(place) {
    const pack = packs[place]; if (!pack) return [];
    return (pack.clips || []).map((c) => ({
      id: c.id, url: c.url, kind: c.kind === 'parla' ? 'parla' : 'base',
      from: c.from || HOME, to: c.to || c.from || HOME,
      mood: [], event: '', outfit: '', quality: '',
      weight: Math.max(0.05, Math.min(10, Number(c.weight) || 1)),
      label: String(c.label || c.id).slice(0, 60),
    }));
  }

  function stillOf(place) {
    const pack = packs[place];
    return (pack && pack.still) ? pack.still : '';
  }


  // v2d-62: inquadratura viso+spalle (non figura intera). Leggera variazione a ogni chiamata, come al telefono.
  function applyFrame(on) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    stage.classList.toggle('loc-call', !!on);
    if (!on) {
      stage.style.removeProperty('--call-zoom');
      stage.style.removeProperty('--call-vx');
      stage.style.removeProperty('--call-vy');
      return;
    }
    const zoom = 2.42 + Math.random() * 0.28; // 2.42–2.70: abbastanza stretto, 720p non troppo morbido
    const vx = 48 + Math.random() * 5;       // viso circa in centro, un filo a destra/sinistra
    const vy = 26 + Math.random() * 6;       // viso nel terzo alto, con un po' di cielo sopra
    stage.style.setProperty('--call-zoom', zoom.toFixed(3));
    stage.style.setProperty('--call-fx', '41.5%');
    stage.style.setProperty('--call-fy', '14%');
    stage.style.setProperty('--call-vx', vx.toFixed(1) + '%');
    stage.style.setProperty('--call-vy', vy.toFixed(1) + '%');
  }

  App.locationCall = {
    loaded: () => loaded,
    place: () => current,
    places: () => (index.places || []).slice(),
    usingClips: () => !!(inVideoCall() && current && libOf(current).length),
    lib: () => current ? libOf(current) : [],
    still: () => current ? stillOf(current) : '',
    async load() {
      try {
        const idx = await App.api('/api/locations');
        if (idx && Array.isArray(idx.places)) index = idx;
        for (const p of (index.places || [])) {
          if (!p.ready) continue;
          const pack = await App.api('/api/locations/' + encodeURIComponent(p.id));
          if (pack && pack.clips) packs[p.id] = pack;
        }
        loaded = true;
      } catch { loaded = true; }
    },
    onCallStart(mode) {
      if (mode === 'voice') { current = null; applyFrame(false); return; }
      const ready = readyPlaces();
      current = naturalPick(ready);
      if (current && App.ls) App.ls.set(LS_LAST, current);
      applyFrame(!!current);
      if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
    },
    onMode(mode) {
      if (!App.call || !App.call.active) return;
      if (mode === 'voice') { /* vocale: niente clip di luogo a tutto schermo */ }
      else if (!current) this.onCallStart('video');
      if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
    },
    onCallEnd() { current = null; applyFrame(false); },
  };

  document.addEventListener('DOMContentLoaded', () => { if (App.locationCall) App.locationCall.load(); });
})();
