/* 3D facoltativo (GLB locale, three.js). La foto resta il default: questo file si carica solo se l'utente sceglie 3D. */
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
    upper: 'Bip01_Spine2', head: 'Bip01_Head', jaw: 'Bip01_MJaw',
    clavL: 'Bip01_L_Clavicle', clavR: 'Bip01_R_Clavicle',
    eyeL: 'Bip01_LEye', eyeR: 'Bip01_REye',
    leftUpperArm: 'Bip01_L_UpperArm', leftLowerArm: 'Bip01_L_Forearm',
    rightUpperArm: 'Bip01_R_UpperArm', rightLowerArm: 'Bip01_R_Forearm',
    leftUpperLeg: 'Bip01_L_Thigh', leftLowerLeg: 'Bip01_L_Calf',
    rightUpperLeg: 'Bip01_R_Thigh', rightLowerLeg: 'Bip01_R_Calf',
    blinkL: 'Bip01_LEyeBlinkTop', blinkR: 'Bip01_REyeBlinkTop',
  };
  let view = 'photo', lib = null, model = null, renderer, scene, camera, raf = 0, last = 0, acc = 0;
  let readyP = null, failed = '', base = 'stand', clip = null, mouth = 0, wide = 0.5, speaking = false;
  let restoreFull = false, blinkAt = -10, nextBlink = 1.6;
  const rest = new Map();
  const posed = {};
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0.8 };

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
  function childNamed(n, re) {
    let child = null;
    n.traverse((c) => { if (!child && c !== n && re.test(c.name || '')) child = c; });
    return child;
  }
  function aimChild(n, child, target) {
    const THREE = lib.THREE;
    if (!n || !child) return;
    n.updateWorldMatrix(true, true);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    n.getWorldPosition(a); child.getWorldPosition(b);
    const current = b.sub(a);
    if (current.lengthSq() < 1e-8) return;
    current.normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(current, target.clone().normalize());
    const parentQ = new THREE.Quaternion();
    if (n.parent) n.parent.getWorldQuaternion(parentQ);
    const worldQ = new THREE.Quaternion();
    n.getWorldQuaternion(worldQ);
    n.quaternion.copy(parentQ.invert().multiply(delta.multiply(worldQ)));
    n.updateWorldMatrix(true, true);
  }
  function dropArms() {
    const THREE = lib.THREE;
    ['leftUpperArm', 'rightUpperArm'].forEach((name) => {
      const n = bone(name); if (!n) return;
      const fore = childNamed(n, /Forearm/);
      if (!fore) return;
      n.updateWorldMatrix(true, true);
      const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3();
      n.getWorldPosition(shoulder); fore.getWorldPosition(elbow);
      const side = Math.sign(elbow.x - shoulder.x) || (name.startsWith('left') ? -1 : 1);
      aimChild(n, fore, new THREE.Vector3(side * 0.22, -1, 0.12));
      const hand = childNamed(fore, /Hand/);
      if (hand) aimChild(fore, hand, new THREE.Vector3(side * 0.08, -1, 0.18));
    });
  }
  let currentLook = null;
  const texOriginal = new Map();
  function activeLook() { return currentLook || (window.LookParse && LookParse.DEFAULT) || null; }
  function clampByte(n) { return n < 0 ? 0 : n > 255 ? 255 : n | 0; }
  function cloth(r, g, b, target) {
    const k = ((r + g + b) / 3) / 170;
    const s = 0.42 + k;
    return [clampByte(target[0] * s), clampByte(target[1] * s), clampByte(target[2] * s)];
  }
  function skinTint(r, g, b) {
    return [clampByte(r * 0.74 + 236 * 0.26), clampByte(g * 0.72 + 206 * 0.28), clampByte(b * 0.7 + 186 * 0.3)];
  }
  function hairTint(r, g, b, target) {
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const s = 0.62 + luma / 220;
    return [clampByte(target[0] * s), clampByte(target[1] * s), clampByte(target[2] * s)];
  }
  function bodyKind(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 22) return 'skip';
    if (b > r + 6 && b + 4 >= g && r < 140 && mx < 130) return 'bottom';
    if (r > 80 && g > 45 && b > 30 && r > g - 8 && g + 8 >= b && r > b + 12 && r < 250 && b < 210 && b <= r) return 'skin';
    if (mx < 72 && mx - mn < 18 && b <= r + 4) return 'shoes';
    if (mx - mn < 48 && mx > 90) return 'top';
    return 'other';
  }
  function paintBuffer(src, kind, look) {
    const out = new Uint8ClampedArray(src.data);
    const w = src.width;
    for (let i = 0, p = 0; i < out.length; i += 4, p++) {
      const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2], a = src.data[i + 3];
      if (kind === 'opacity') {
        if (a < 8) continue;
        const h = hairTint(r, g, b, look.hair);
        out[i] = h[0]; out[i + 1] = h[1]; out[i + 2] = h[2];
        continue;
      }
      if (kind === 'head') {
        const x = p % w, y = (p / w) | 0;
        if (y > 530 && x < 190 && r > 48 && r < 150 && g < r && b < 90 && r + g + b < 380) {
          const e = hairTint(r, g, b, look.eyes);
          out[i] = e[0]; out[i + 1] = e[1]; out[i + 2] = e[2];
          continue;
        }
        const mx = Math.max(r, g, b);
        if (mx > 16 && !(r > 150 && g > 100 && b > 80) && r < 140 && r + 8 >= g && g + 12 >= b) {
          const h = hairTint(r, g, b, look.hair);
          out[i] = h[0]; out[i + 1] = h[1]; out[i + 2] = h[2];
          continue;
        }
        if (r > 140 && g > 90 && b > 70) {
          const s = skinTint(r, g, b);
          out[i] = s[0]; out[i + 1] = s[1]; out[i + 2] = s[2];
        }
        continue;
      }
      const bk = bodyKind(r, g, b);
      let c = null;
      if (bk === 'top') c = cloth(r, g, b, look.top);
      else if (bk === 'bottom') c = cloth(r, g, b, look.bottom);
      else if (bk === 'shoes') c = cloth(r, g, b, look.shoes);
      else if (bk === 'skin') c = skinTint(r, g, b);
      if (c) { out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; }
    }
    return new ImageData(out, src.width, src.height);
  }
  function sourcePixels(material, key) {
    if (texOriginal.has(key)) return texOriginal.get(key);
    const img = material.map && material.map.image;
    if (!img || !img.width) return null;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    texOriginal.set(key, data);
    return data;
  }
  function paintLook(look) {
    if (!model || !look || !lib) return;
    model.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m) => {
        if (!m || !m.map) return;
        const name = m.name || '';
        const kind = /opacity/i.test(name) ? 'opacity' : /head/i.test(name) ? 'head' : /body/i.test(name) ? 'body' : '';
        if (!kind) return;
        const src = sourcePixels(m, kind);
        if (!src) return;
        const painted = paintBuffer(src, kind, look);
        const canvas = document.createElement('canvas');
        canvas.width = painted.width; canvas.height = painted.height;
        canvas.getContext('2d').putImageData(painted, 0, 0);
        const tex = new lib.THREE.CanvasTexture(canvas);
        tex.colorSpace = lib.THREE.SRGBColorSpace;
        tex.flipY = m.map.flipY;
        tex.wrapS = m.map.wrapS; tex.wrapT = m.map.wrapT;
        tex.needsUpdate = true;
        const prev = m.userData.paintTex;
        m.map = tex; m.userData.paintTex = tex; m.needsUpdate = true;
        if (prev) prev.dispose();
      });
    });
  }
  function applyBody(look) {
    if (!model || !look) return;
    const base = model.userData.baseScale || model.scale.x || 1;
    model.scale.setScalar(base * (look.height || 1));
    const hips = bone('hips');
    if (hips) hips.scale.set(look.hips || 1, 1, look.hips || 1);
    const sh = look.shoulders || 1;
    ['clavL', 'clavR'].forEach((n) => { const b = bone(n); if (b) b.scale.set(1, sh, 1); });
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
    model.userData.baseScale = model.scale.x;
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
  function noise(t, seed) {
    const s = seed || 0;
    return Math.sin(t * 0.23 + s) * 0.42
      + Math.sin(t * 0.51 + s * 1.7) * 0.28
      + Math.sin(t * 0.11 + s * 2.4) * 0.18
      + Math.sin(t * 0.87 + s * 0.6) * 0.12;
  }
  function stepGaze(t) {
    if (t >= gaze.next) {
      gaze.tx = noise(t, 8.2) * 0.08;
      gaze.ty = noise(t, 5.4) * 0.05;
      gaze.next = t + 1.6 + Math.abs(noise(t, 3.3)) * 2.8;
    }
    gaze.x += (gaze.tx - gaze.x) * 0.06;
    gaze.y += (gaze.ty - gaze.y) * 0.06;
  }
  function blinkAmt(t) {
    if (t >= nextBlink) { blinkAt = t; nextBlink = t + 2.4 + Math.abs(noise(t, 6.5)) * 3.6; }
    const u = (t - blinkAt) / 0.16;
    if (u <= 0 || u >= 1) return 0;
    return Math.sin(u * Math.PI);
  }
  function idleOffsets(t, talking) {
    const breath = 0.55 + 0.45 * noise(t * 0.72, 1.1);
    const o = {
      hips: [0.012 * noise(t, 2.2), 0.02 * noise(t, 1.4), 0.035 * noise(t, 4.1)],
      spine: [0.02 * breath, 0.012 * noise(t, 3.2), 0.018 * noise(t, 2.8)],
      chest: [0.032 * breath, 0, 0.014 * noise(t, 6.1)],
      upper: [0.016 * noise(t, 7.2), 0.01 * noise(t, 1.9), 0],
      clavL: [0, 0, 0.02 * noise(t, 5.5)],
      clavR: [0, 0, -0.02 * noise(t, 5.5)],
      head: [
        0.04 * noise(t, 2.6) + (talking ? mouth * 0.07 : 0),
        0.07 * noise(t, 1.2) + (talking ? noise(t, 9.1) * 0.03 : 0),
        0.015 * noise(t, 4.4),
      ],
      eyeL: [gaze.y, gaze.x, 0],
      eyeR: [gaze.y, gaze.x, 0],
    };
    if (!clip) {
      o.leftUpperArm = [0.015 * noise(t, 8.8), 0, 0.012 * noise(t, 3.7)];
      o.rightUpperArm = [0.015 * noise(t, 9.4), 0, -0.012 * noise(t, 3.7)];
    }
    return o;
  }
  function addEuler(a, b) {
    return [(a && a[0] || 0) + (b && b[0] || 0), (a && a[1] || 0) + (b && b[1] || 0), (a && a[2] || 0) + (b && b[2] || 0)];
  }
  function blendBone(name, target, rate) {
    const c = posed[name] || [0, 0, 0];
    const n = [0, 1, 2].map((i) => c[i] + ((target[i] || 0) - c[i]) * rate);
    posed[name] = n;
    applyBone(name, n[0], n[1], n[2]);
  }
  function resize() {
    const st = stage(), c = canvas(); if (!renderer || !st || !c) return;
    const w = Math.max(2, st.clientWidth), h = Math.max(2, st.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!model) return;
    model.updateWorldMatrix(true, true);
    const THREE = lib.THREE;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = camera.fov * Math.PI / 180;
    const fitH = (size.y / 2) / Math.tan(fov / 2);
    const fitW = (size.x / 2) / (Math.tan(fov / 2) * Math.max(0.2, camera.aspect));
    const dist = Math.max(fitH, fitW) * 1.22;
    camera.position.set(center.x, center.y, box.max.z + dist);
    camera.lookAt(center);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (view !== '3d' || !model) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
    acc += dt; if (acc < 1 / 30) return;
    acc = 0;
    resize();
    const t = now / 1000;
    stepGaze(t);
    resetBones();
    let pose = offsets(base === 'sit' ? 'siedi' : '', base === 'sit' ? 1 : 0);
    if (clip) {
      const u = (now - clip.t0) / clip.dur;
      if (u >= 1) endClip();
      else pose = offsets(clip.id, smooth(Math.max(0, Math.min(1, u))));
    }
    const idle = idleOffsets(t, speaking);
    const names = new Set([...Object.keys(pose), ...Object.keys(idle), ...Object.keys(posed)]);
    names.forEach((name) => blendBone(name, addEuler(pose[name], idle[name]), clip ? 0.22 : 0.16));
    const blink = blinkAmt(t) * 0.42;
    applyBone('blinkL', (posed.blinkL ? posed.blinkL[0] : 0) + blink, 0, 0);
    applyBone('blinkR', (posed.blinkR ? posed.blinkR[0] : 0) + blink, 0, 0);
    const jaw = bone('jaw'), qj = rest.get('jaw');
    if (jaw && qj) {
      const open = speaking ? mouth * 0.42 : 0;
      const cur = posed.jaw ? posed.jaw[0] : 0;
      const next = cur + (open - cur) * 0.45;
      posed.jaw = [next, 0, 0];
      jaw.quaternion.copy(qj);
      jaw.rotateX(next);
    }
    if (clip && clip.id === 'cammina') model.position.x = Math.sin(((now - clip.t0) / clip.dur) * Math.PI) * 0.28;
    else model.position.x += ((noise(t, 2.2) * 0.012) - model.position.x) * 0.08;
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
    if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  async function load() {
    if (model) { showCanvas(true); resize(); return true; }
    if (readyP) return readyP;
    readyP = (async () => {
      const st = stage(), c = canvas(); if (!st || !c) throw new Error('Palco assente');
      const { THREE, GLTFLoader } = await ensureLibs();
      renderer = new THREE.WebGLRenderer({ canvas: c, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
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
      if (currentLook) { paintLook(currentLook); applyBody(currentLook); }
      last = 0; if (!raf) raf = requestAnimationFrame(frame);
      status('Stand-in Rocketbox Female Adult 01: capelli biondi, maglia nera, jeans. Non è la foto.');
      return true;
    })().catch((e) => { failed = 'Modello 3D non caricato' + (e && e.message ? ': ' + e.message : ''); status(failed); showCanvas(false); readyP = null; throw e; });
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
        if (view === '3d' && !document.body.classList.contains('simli-on') && !(App.avatarConv && App.avatarConv.speaking)) {
          const id = match3d(text); if (id) { playGesture(id); return 'play'; }
        }
        return hear(text, opts);
      };
      App.gestures._vrm = true;
    }
  }
  function explicitView() {
    if (!(App.ls && App.me)) return '';
    const pick = App.ls.get('avatarViewPick', '');
    if (pick === 'photo' || pick === 'video' || pick === '3d') return pick;
    const legacy = App.ls.get('avatarView', '');
    if (legacy === 'video' || legacy === '3d') return legacy;
    return '';
  }
  async function applyLook(look) {
    if (!look) return;
    currentLook = look;
    view = '3d';
    const sel = select(); if (sel) sel.value = '3d';
    hook();
    try {
      await load();
      paintLook(look);
      applyBody(look);
      const note = look.gender === 'uomo' ? ' Uomo: stessi parametri sul corpo disponibile, senza un secondo modello.' : '';
      status((look.summary || 'Aspetto aggiornato') + note);
    } catch { /* la foto resta se il 3D non carica */ }
  }
  async function apply(next) {
    const sel = select();
    // Un solo avatar in primo piano. Foto o video solo se il pannello di ripristino lo chiede.
    view = (next === 'photo' || next === 'video') ? next : '3d';
    if (sel && sel.value !== view) sel.value = view;
    hook();
    if (view !== '3d') { showCanvas(false); status('Foto di riserva. Il 3D si riaccende da questo menu.'); return; }
    status('Carico il modello 3D…');
    try { await load(); if (currentLook) { paintLook(currentLook); applyBody(currentLook); } } catch { /* status già scritto */ }
  }
  function sample() {
    return { head: (posed.head || [0, 0, 0]).slice(), chest: (posed.chest || [0, 0, 0]).slice(), hips: (posed.hips || [0, 0, 0]).slice() };
  }
  function bind() {
    const sel = select(); if (!sel || sel._vrm) return; sel._vrm = true;
    sel.addEventListener('change', () => {
      if (App.ls && App.me) App.ls.set('avatarViewPick', sel.value);
      apply(sel.value);
    });
  }
  bind();
  window.addEventListener('resize', resize);
  App.avatar3d = {
    mode, apply, applyLook, lips, play: playGesture, match: match3d, sample,
    look: () => activeLook(),
    ready: () => !!model, failed: () => failed, current: () => clip && clip.id,
  };
})();
