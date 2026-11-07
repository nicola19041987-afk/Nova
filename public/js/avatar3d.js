/* Avatar 3D realistico (GLB locale, three.js). La foto resta il default. */
(function () {
  const MODEL = '/models/nova.glb';
  const FULL = { alzati: 1, siedi: 1, gira: 1, cammina: 1, stira: 1 };
  const GEST = {
    saluto: { dur: 2.8, label: '👋 Saluta' },
    capelli: { dur: 2.6, label: '💇 Si pettina' },
    alzati: { dur: 2.4, label: '🧍 Si alza' },
    siedi: { dur: 2.4, label: '🪑 Si siede' },
    gira: { dur: 2.8, label: '🔄 Si gira' },
    cammina: { dur: 4.2, label: '🚶 Cammina' },
    stira: { dur: 3.2, label: '🙆 Si stiracchia' },
  };
  const KEYS = [
    ['cammina', ['due passi', 'cammin', 'fai un passo']],
    ['stira', ['stiracchi', 'stirati']],
    ['gira', ['girati', 'voltati']],
    ['siedi', ['siediti', 'seduta']],
    ['alzati', ['alzati', 'in piedi']],
    ['capelli', ['pettin', 'capell']],
    ['saluto', ['ciao con la mano', 'salut']],
  ];
  const MAP = {
    hips: 'Bip01_Pelvis', spine: 'Bip01_Spine', chest: 'Bip01_Spine1',
    head: 'Bip01_Head', jaw: 'Bip01_MJaw',
    leftUpperArm: 'Bip01_L_UpperArm', leftLowerArm: 'Bip01_L_Forearm',
    rightUpperArm: 'Bip01_R_UpperArm', rightLowerArm: 'Bip01_R_Forearm',
    leftUpperLeg: 'Bip01_L_Thigh', leftLowerLeg: 'Bip01_L_Calf',
    rightUpperLeg: 'Bip01_R_Thigh', rightLowerLeg: 'Bip01_R_Calf',
    blinkL: 'Bip01_LEyeBlinkTop', blinkR: 'Bip01_REyeBlinkTop',
  };
  let view = 'photo', lib = null, model = null, renderer, scene, camera, raf = 0, last = 0, acc = 0;
  let readyP = null, failed = '', base = 'stand', clip = null, mouth = 0, wide = 0.5, speaking = false;
  let restoreFull = false;
  const rest = new Map();

  function mode() { return view; }
  function select() { return document.getElementById('avatar-view'); }
  function status(t) { const el = document.getElementById('avatar-view-status'); if (el && t) el.textContent = t; }
  function canvas() { return document.getElementById('vrm-view'); }
  function stage() { return document.getElementById('stage'); }
  function smooth(u) { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); }
  function bone(name) { return model && model.getObjectByName(MAP[name] || name); }
  function remember() {
    rest.clear();
    Object.keys(MAP).forEach((name) => { const n = bone(name); if (n) rest.set(name, n.quaternion.clone()); });
  }
  function applyBone(name, x, y, z) {
    const n = bone(name), q0 = rest.get(name); if (!n || !q0) return;
    n.quaternion.copy(q0).multiply(new lib.THREE.Quaternion().setFromEuler(new lib.THREE.Euler(x || 0, y || 0, z || 0)));
  }
  function resetBones() { rest.forEach((q, name) => { const n = bone(name); if (n) n.quaternion.copy(q); }); }
  function dropArms() {
    const THREE = lib.THREE;
    ['leftUpperArm', 'rightUpperArm'].forEach((name) => {
      const n = bone(name); if (!n) return;
      let child = null;
      n.traverse((c) => { if (!child && c !== n && /Forearm/.test(c.name || '')) child = c; });
      if (!child) return;
      const start = n.quaternion.clone();
      let best = start.clone(), bestY = Infinity;
      const axis = new THREE.Vector3();
      ['x', 'y', 'z'].forEach((ax) => {
        for (let deg = -180; deg <= 180; deg += 10) {
          n.quaternion.copy(start);
          axis.set(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0);
          n.rotateOnAxis(axis, deg * Math.PI / 180);
          n.updateWorldMatrix(true, true);
          const hand = new THREE.Vector3(), shoulder = new THREE.Vector3();
          child.getWorldPosition(hand); n.getWorldPosition(shoulder);
          const down = hand.y - shoulder.y;
          if (down < bestY) { bestY = down; best = n.quaternion.clone(); }
        }
      });
      n.quaternion.copy(best);
    });
  }
  function fitModel() {
    const THREE = lib.THREE;
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = 1.68 / Math.max(0.01, size.y);
    model.scale.setScalar(s);
    model.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
  }
  function lips(level, shape, on) {
    mouth = Math.max(0, Math.min(1, level || 0));
    wide = shape == null ? 0.5 : Math.max(0, Math.min(1, shape));
    speaking = !!on && mouth > 0.04;
  }
  function offsets(name, u) {
    const s = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI), w = Math.sin(u * Math.PI * 5);
    const o = {};
    if (name === 'saluto') { o.rightUpperArm = [0.2, 0, -1.05 * s]; o.rightLowerArm = [0, 0.15 * w * s, -0.9 * s]; }
    if (name === 'capelli') { o.rightUpperArm = [-0.5 * s, 0, -0.7 * s]; o.rightLowerArm = [-1.15 * s, 0, 0]; o.head = [0.08 * s, -0.15 * s, 0]; }
    if (name === 'stira') { o.leftUpperArm = [0.15 * s, 0, 2.4 * s]; o.rightUpperArm = [0.15 * s, 0, -2.4 * s]; o.spine = [-0.12 * s, 0, 0]; }
    if (name === 'gira') { o.hips = [0, u * Math.PI * 2, 0]; }
    if (name === 'cammina') {
      const step = Math.sin(u * Math.PI * 4);
      o.leftUpperLeg = [0.6 * step, 0, 0]; o.rightUpperLeg = [-0.6 * step, 0, 0];
      o.leftLowerLeg = [Math.max(0, -step) * 0.8, 0, 0]; o.rightLowerLeg = [Math.max(0, step) * 0.8, 0, 0];
      o.leftUpperArm = [0.35 * step, 0, 0]; o.rightUpperArm = [-0.35 * step, 0, 0];
    }
    const held = name === 'siedi' ? smooth(u) : (name === 'alzati' ? 1 - smooth(u) : (base === 'sit' ? 1 : 0));
    if (held) {
      o.hips = [(o.hips && o.hips[0] || 0) - 0.2 * held, (o.hips && o.hips[1] || 0), 0];
      o.leftUpperLeg = [(o.leftUpperLeg && o.leftUpperLeg[0] || 0) - 1.2 * held, 0, 0.06 * held];
      o.rightUpperLeg = [(o.rightUpperLeg && o.rightUpperLeg[0] || 0) - 1.2 * held, 0, -0.06 * held];
      o.leftLowerLeg = [(o.leftLowerLeg && o.leftLowerLeg[0] || 0) + 1.3 * held, 0, 0];
      o.rightLowerLeg = [(o.rightLowerLeg && o.rightLowerLeg[0] || 0) + 1.3 * held, 0, 0];
    }
    return o;
  }
  function playGesture(id) {
    if (!GEST[id] || view !== '3d') return false;
    if (FULL[id] && App.solo && App.solo.toggleFull && !App.solo.full) { restoreFull = true; App.solo.toggleFull(true); }
    else restoreFull = false;
    clip = { id, t0: performance.now(), dur: GEST[id].dur * 1000 };
    return true;
  }
  function match3d(text) {
    const t = String(text || '').toLowerCase();
    for (const [id, keys] of KEYS) for (const k of keys) if (k && t.includes(k)) return id;
    return null;
  }
  function endClip() {
    if (!clip) return;
    if (clip.id === 'siedi') base = 'sit';
    if (clip.id === 'alzati') base = 'stand';
    if (restoreFull && App.solo && App.solo.toggleFull) App.solo.toggleFull(false);
    restoreFull = false; clip = null;
  }
  function resize() {
    const st = stage(), c = canvas(); if (!renderer || !st || !c) return;
    const w = Math.max(2, st.clientWidth), h = Math.max(2, st.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const full = document.body.classList.contains('av-full-on');
    camera.position.set(0, full ? 0.86 : 1.42, full ? 3.6 : 1.35);
    camera.lookAt(0, full ? 0.84 : 1.38, 0);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (view !== '3d' || !model) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
    acc += dt; if (acc < 1 / 30) return;
    acc = 0;
    resize();
    const t = now / 1000;
    resetBones();
    let pose = offsets(base === 'sit' ? 'siedi' : '', base === 'sit' ? 1 : 0);
    if (clip) {
      const u = (now - clip.t0) / clip.dur;
      if (u >= 1) endClip();
      else pose = offsets(clip.id, u);
    }
    Object.entries(pose).forEach(([name, e]) => applyBone(name, e[0], e[1], e[2]));
    if (!clip) {
      applyBone('chest', Math.sin(t * 1.5) * 0.03, 0, 0);
      applyBone('head', Math.sin(t * 0.35) * 0.03, Math.sin(t * 0.22) * 0.18, 0);
    }
    const blink = Math.sin(t * 1.3) > 0.985 ? 0.45 : 0;
    applyBone('blinkL', blink, 0, 0);
    applyBone('blinkR', blink, 0, 0);
    const jaw = bone('jaw'), qj = rest.get('jaw');
    if (jaw && qj) { jaw.quaternion.copy(qj); jaw.rotateX(speaking ? mouth * 0.4 : 0); }
    if (clip && clip.id === 'cammina') model.position.x = Math.sin(((now - clip.t0) / clip.dur) * Math.PI) * 0.28;
    else model.position.x += (0 - model.position.x) * 0.12;
    renderer.render(scene, camera);
  }
  async function ensureLibs() {
    if (lib) return lib;
    const [THREE, gltf] = await Promise.all([
      import('/vendor/three/build/three.module.js'),
      import('/vendor/three/examples/jsm/loaders/GLTFLoader.js'),
    ]);
    lib = { THREE, GLTFLoader: gltf.GLTFLoader };
    return lib;
  }
  function showCanvas(on) {
    const c = canvas(); if (!c) return;
    c.hidden = !on;
    document.body.classList.toggle('vrm-on', !!on);
  }
  async function load() {
    if (model) { showCanvas(true); resize(); return true; }
    if (readyP) return readyP;
    readyP = (async () => {
      const st = stage(), c = canvas(); if (!st || !c) throw new Error('Palco assente');
      const { THREE, GLTFLoader } = await ensureLibs();
      renderer = new THREE.WebGLRenderer({ canvas: c, antialias: false, alpha: false, powerPreference: 'high-performance' });
      renderer.setClearColor(0xe8ebf0, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
      scene.add(new THREE.HemisphereLight(0xfff6ee, 0xb7c0c8, 1.2));
      const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(0.6, 1.8, 1.4); scene.add(key);
      const gltf = await new GLTFLoader().loadAsync(MODEL);
      model = gltf.scene;
      model.traverse((o) => { o.frustumCulled = false; if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { if (m) { m.metalness = 0; m.roughness = Math.min(1, m.roughness || 0.8); } }); } });
      scene.add(model);
      dropArms();
      fitModel();
      remember();
      showCanvas(true); resize();
      last = 0; if (!raf) raf = requestAnimationFrame(frame);
      status('Avatar 3D: Female Adult 02 (Microsoft Rocketbox, MIT).');
      return true;
    })().catch((e) => { failed = (e && e.message) || '3D non caricato'; status(failed); showCanvas(false); readyP = null; throw e; });
    return readyP;
  }
  function paintMenu() {
    const list = document.getElementById('act-list'); if (!list) return;
    list.querySelectorAll('[data-vrm-only]').forEach((n) => n.remove());
    if (view !== '3d') return;
    const extra = ['alzati', 'siedi', 'gira', 'cammina', 'stira'].filter((id) => !list.querySelector(`[data-act="${id}"]`));
    list.insertAdjacentHTML('afterbegin', extra.map((id) => `<button type="button" data-act="${id}" data-vrm-only="1">${GEST[id].label}</button>`).join(''));
  }
  function hook() {
    if (App.actions && App.actions.render && !App.actions._vrm) {
      const render = App.actions.render.bind(App.actions);
      App.actions.render = function () { const r = render(); paintMenu(); return r; };
      const play = App.actions.play.bind(App.actions);
      App.actions.play = function (id, why) { if (view === '3d' && GEST[id]) return playGesture(id); return play(id, why); };
      App.actions._vrm = true;
    }
    if (App.gestures && App.gestures.hear && !App.gestures._vrm) {
      const hear = App.gestures.hear.bind(App.gestures);
      App.gestures.hear = function (text, opts) {
        if (view === '3d') { const id = match3d(text); if (id) { playGesture(id); return 'play'; } }
        return hear(text, opts);
      };
      App.gestures._vrm = true;
    }
  }
  async function apply(next) {
    const sel = select();
    view = next || (App.ls && App.me ? App.ls.get('avatarView', 'photo') : (sel && sel.value) || 'photo');
    if (!['photo', 'video', '3d'].includes(view)) view = 'photo';
    if (sel && sel.value !== view) sel.value = view;
    if (App.ls && App.me) App.ls.set('avatarView', view);
    hook();
    if (view !== '3d') { showCanvas(false); if (view === 'photo') status('Foto e videochiamata, come sempre.'); else status('Videochiamata: volto Simli se la chiave c’è, altrimenti la foto.'); return; }
    status('Carico il modello 3D…');
    try { await load(); } catch { /* status già scritto */ }
  }
  function bind() {
    const sel = select(); if (!sel || sel._vrm) return; sel._vrm = true;
    sel.addEventListener('change', () => apply(sel.value));
  }
  bind();
  window.addEventListener('resize', resize);
  App.avatar3d = {
    mode, apply, lips, play: playGesture, match: match3d,
    ready: () => !!model, failed: () => failed, current: () => clip && clip.id,
  };
})();
