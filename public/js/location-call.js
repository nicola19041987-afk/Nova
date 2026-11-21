/* location-call.js — in videochiamata Ira si vede già nel luogo da cui si collega
 * (showroom, barca, auto, casa, palestra). 2D, clip muti, nessuna scritta sul video.
 * La voce resta solo quella in tempo reale. La foto della chat non si tocca.
 * I clip sono Ira già nella scena: mai un ritaglio sulla foto di sfondo.
 * Prima chiamata: showroom. Poi rotazione deterministica persistita in localStorage.
 */
(function () {
  const HOME = 'petto';
  const LS_LAST = 'locationLast';
  const LS_FORCE = 'locationForce'; // solo prova tecnica; vuoto = rotazione
  const DEFAULT_ORDER = ['showroom', 'barca', 'auto', 'salotto', 'camera', 'cucina', 'palestra'];
  let index = { default: 'showroom', pick: 'rotation', order: DEFAULT_ORDER.slice(), places: [] };
  let packs = {}; // id -> { still, framing, clips:[{id,url,kind,from,to,label,weight}] }
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

  function rotationPick(ready) {
    if (!ready.length) return null;
    if (ready.length === 1) return ready[0].id;
    const force = App.ls ? App.ls.get(LS_FORCE, '') : '';
    if (force && ready.some((p) => p.id === force)) return force;
    const readyIds = ready.map((p) => p.id);
    const order = ((Array.isArray(index.order) && index.order.length) ? index.order : DEFAULT_ORDER)
      .filter((id) => readyIds.includes(id));
    for (const id of readyIds) if (!order.includes(id)) order.push(id);
    if (!order.length) return ready[0].id;
    const last = App.ls ? App.ls.get(LS_LAST, '') : '';
    // prima chiamata (o storage vuoto): sempre showroom se pronto
    if (!last || !order.includes(last)) {
      return order.includes('showroom') ? 'showroom' : order[0];
    }
    const i = order.indexOf(last);
    let next = order[(i + 1) % order.length];
    if (next === last && order.length > 1) next = order[(i + 2) % order.length];
    return next;
  }

  function libOf(place) {
    const pack = packs[place]; if (!pack) return [];
    return (pack.clips || []).map((c) => ({
      id: String(place) + '-' + c.id, url: c.url, kind: c.kind === 'parla' ? 'parla' : 'base',
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

  function isClose(place) {
    return !!(place && packs[place] && packs[place].framing === 'close');
  }

  // v2d-62: showroom a figura intera → zoom viso+spalle. Pacchetti già ravvicinati: zoom lieve, stessa etichetta/inquadratura risultante.
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
    if (isClose(current)) {
      const zoom = 1.05 + Math.random() * 0.10; // 1.05–1.15: già viso+spalle, variazione da telefono in mano
      const vx = 50 + Math.random() * 2 - 1;
      const vy = 30 + Math.random() * 3 - 1.5;
      stage.style.setProperty('--call-zoom', zoom.toFixed(3));
      stage.style.setProperty('--call-fx', '50%');
      stage.style.setProperty('--call-fy', '30%');
      stage.style.setProperty('--call-vx', vx.toFixed(1) + '%');
      stage.style.setProperty('--call-vy', vy.toFixed(1) + '%');
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
      // start() chiama setMode (onMode) e poi di nuovo onCallStart: non rimescolare il luogo già scelto in questa chiamata.
      if (current) {
        applyFrame(true);
        if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
        return;
      }
      const ready = readyPlaces();
      current = rotationPick(ready);
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
