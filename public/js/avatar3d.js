/* Prototipo avatar 3D (three.js + three-vrm, file locali). La foto resta il default. */
(function () {
  const MODEL = '/models/nova-base.vrm';
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
  let view = 'photo', lib = null, vrm = null, renderer, scene, camera, raf = 0, last = 0, acc = 0;
  let readyP = null, failed = '', base = 'stand', clip = null, mouth = 0, wide = 0.5, speaking = false;
  let restoreFull = false;
  const rest = new Map();

  function mode() { return view; }
  function select() { return document.getElementById('avatar-view'); }
  function status(t) { const el = document.getElementById('avatar-view-status'); if (el && t) el.textContent = t; }
  function canvas() { return document.getElementById('vrm-view'); }
  function stage() { return document.getElementById('stage'); }
  function smooth(u) { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); }
  function bone(name) { return vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(name); }
  function remember() {
    rest.clear();
    ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'].forEach((name) => {
      const n = bone(name); if (n) rest.set(name, n.quaternion.clone());
    });
  }
  function applyBone(name, x, y, z) {
    const n = bone(name), q0 = rest.get(name); if (!n || !q0) return;
    const e = new lib.THREE.Euler(x || 0, y || 0, z || 0, 'XYZ');
    n.quaternion.copy(q0).multiply(new lib.THREE.Quaternion().setFromEuler(e));
  }
  function resetBones() { rest.forEach((q, name) => { const n = bone(name); if (n) n.quaternion.copy(q); }); }
  function tint() {
    const THREE = lib.THREE;
    const brown = new THREE.Color('#6b3a22'), eye = new THREE.Color('#c5e4f5'), skin = new THREE.Color('#f3d7cb');
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const next = list.map((m) => {
        if (!m) return m;
        const blob = ((o.name || '') + ' ' + (m.name || '')).toLowerCase();
        const mat = new THREE.MeshStandardMaterial({
          map: m.map || null,
          color: m.color ? m.color.clone() : skin.clone(),
          roughness: 0.82,
          metalness: 0,
        });
        mat.name = m.name || '';
        if (/hair|kami/.test(blob)) mat.color.lerp(brown, 0.72);
        else if (/iris|hitomi/.test(blob)) mat.color.lerp(eye, 0.7);
        else if (/skin|face|body|hada/.test(blob) && !m.map) mat.color.lerp(skin, 0.5);
        return mat;
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });
  }
  function expr(name, value) {
    const m = vrm && vrm.expressionManager; if (!m) return;
    try { m.setValue(name, Math.max(0, Math.min(1, value))); } catch { /* espressione assente */ }
  }
  function lips(level, shape, on) {
    mouth = Math.max(0, Math.min(1, level || 0));
    wide = shape == null ? 0.5 : Math.max(0, Math.min(1, shape));
    speaking = !!on && mouth > 0.04;
  }
  function visemes() {
    ['aa', 'ih', 'ou', 'ee', 'oh'].forEach((n) => expr(n, 0));
    if (!speaking) return;
    const open = mouth;
    if (wide > 0.72) expr(open > 0.45 ? 'ee' : 'ih', open);
    else if (wide > 0.38) expr('aa', open);
    else expr(open > 0.55 ? 'oh' : 'ou', open);
  }
  function offsets(name, u) {
    const s = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI), w = Math.sin(u * Math.PI * 5);
    const o = {};
    if (name === 'saluto') { o.rightUpperArm = [0.15, 0, -1.15 * s]; o.rightLowerArm = [0, 0, (-0.35 - 0.45 * w) * s]; }
    if (name === 'capelli') { o.rightUpperArm = [-0.4 * s, 0, -0.9 * s]; o.rightLowerArm = [-1.1 * s, 0.2 * s, 0]; o.head = [0.08 * s, -0.12 * s, 0]; }
    if (name === 'stira') { o.leftUpperArm = [0.2 * s, 0, 1.3 * s]; o.rightUpperArm = [0.2 * s, 0, -1.3 * s]; o.spine = [-0.12 * s, 0, 0]; }
    if (name === 'gira') { o.hips = [0, u * Math.PI * 2, 0]; }
    if (name === 'cammina') {
      const step = Math.sin(u * Math.PI * 4);
      o.leftUpperLeg = [0.55 * step, 0, 0]; o.rightUpperLeg = [-0.55 * step, 0, 0];
      o.leftLowerLeg = [Math.max(0, -step) * 0.7, 0, 0]; o.rightLowerLeg = [Math.max(0, step) * 0.7, 0, 0];
      o.leftUpperArm = [-0.35 * step, 0, 0.15]; o.rightUpperArm = [0.35 * step, 0, -0.15];
    }
    const held = name === 'siedi' ? smooth(u) : (name === 'alzati' ? 1 - smooth(u) : (base === 'sit' ? 1 : 0));
    const sit = held;
    if (sit) {
      o.hips = [(o.hips && o.hips[0] || 0) - 0.15 * sit, (o.hips && o.hips[1] || 0), 0];
      o.leftUpperLeg = [(o.leftUpperLeg && o.leftUpperLeg[0] || 0) - 1.15 * sit, 0, 0.08 * sit];
      o.rightUpperLeg = [(o.rightUpperLeg && o.rightUpperLeg[0] || 0) - 1.15 * sit, 0, -0.08 * sit];
      o.leftLowerLeg = [(o.leftLowerLeg && o.leftLowerLeg[0] || 0) + 1.25 * sit, 0, 0];
      o.rightLowerLeg = [(o.rightLowerLeg && o.rightLowerLeg[0] || 0) + 1.25 * sit, 0, 0];
    }
    return o;
  }
  function playGesture(id) {
    if (!GEST[id] || view !== '3d') return false;
    const full = !!FULL[id];
    if (full && App.solo && App.solo.toggleFull && !App.solo.full) { restoreFull = true; App.solo.toggleFull(true); }
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
    camera.position.set(0, full ? 0.95 : 1.35, full ? 3.15 : 1.7);
    camera.lookAt(0, full ? 0.9 : 1.25, 0);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (view !== '3d' || !vrm) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
    acc += dt; if (acc < 1 / 30) return;
    const step = acc; acc = 0;
    const t = now / 1000;
    resetBones();
    const idle = clip ? offsets(base === 'sit' ? 'siedi' : 'alzati', base === 'sit' ? 1 : 0) : offsets(base === 'sit' ? 'siedi' : '', 1);
    let pose = idle;
    if (clip) {
      const u = (now - clip.t0) / clip.dur;
      if (u >= 1) endClip();
      else pose = offsets(clip.id, smooth(u));
    }
    Object.entries(pose).forEach(([name, e]) => applyBone(name, e[0], e[1], e[2]));
    if (!clip) {
      applyBone('chest', Math.sin(t * 1.5) * 0.035, 0, 0);
      applyBone('head', Math.sin(t * 0.35) * 0.04, Math.sin(t * 0.22) * 0.22, 0);
    }
    const blink = (Math.sin(t * 1.7) > 0.97) ? 1 : 0;
    expr('blink', blink);
    visemes();
    if (vrm.expressionManager) vrm.expressionManager.update();
    if (clip && clip.id === 'cammina' && vrm.scene) vrm.scene.position.x = Math.sin(((now - clip.t0) / clip.dur) * Math.PI) * 0.28;
    else if (vrm.scene) vrm.scene.position.x += (0 - vrm.scene.position.x) * 0.15;
    vrm.update(step);
    renderer.render(scene, camera);
  }
  async function ensureLibs() {
    if (lib) return lib;
    const [THREE, gltf, VRM] = await Promise.all([
      import('/vendor/three/build/three.module.js'),
      import('/vendor/three/examples/jsm/loaders/GLTFLoader.js'),
      import('/vendor/three-vrm/three-vrm.module.js'),
    ]);
    lib = { THREE, GLTFLoader: gltf.GLTFLoader, VRMLoaderPlugin: VRM.VRMLoaderPlugin, VRMUtils: VRM.VRMUtils };
    return lib;
  }
  function showCanvas(on) {
    const c = canvas(); if (!c) return;
    c.hidden = !on;
    document.body.classList.toggle('vrm-on', !!on);
  }
  async function load() {
    if (vrm) { showCanvas(true); resize(); return true; }
    if (readyP) return readyP;
    readyP = (async () => {
      const st = stage(), c = canvas(); if (!st || !c) throw new Error('Palco assente');
      const { THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils } = await ensureLibs();
      renderer = new THREE.WebGLRenderer({ canvas: c, antialias: false, alpha: false, powerPreference: 'high-performance' });
      renderer.setClearColor(0xe8ebf0, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
      scene.add(new THREE.HemisphereLight(0xfff4ea, 0xb9c0c8, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(0.4, 1.6, 1.2); scene.add(key);
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(MODEL);
      vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('File VRM senza avatar');
      if (VRMUtils.removeUnnecessaryVertices) VRMUtils.removeUnnecessaryVertices(gltf.scene);
      vrm.scene.traverse((o) => { o.frustumCulled = false; });
      vrm.scene.rotation.y = Math.PI;
      scene.add(vrm.scene);
      tint();
      remember();
      showCanvas(true); resize();
      last = 0; if (!raf) raf = requestAnimationFrame(frame);
      status('Avatar 3D: Sendagaya Shino (CC0), capelli scuriti.');
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
    ready: () => !!vrm, failed: () => failed, current: () => clip && clip.id,
  };
})();
