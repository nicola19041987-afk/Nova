/* Prototipo isolato. Non è collegato alla chat, alla camera o alla foto di produzione.
   Modello: public/models/nova.glb — Female Adult 02, Microsoft Rocketbox, MIT.
   Motore: three.js già venduto in public/vendor/three, MIT. three-vrm non è nel repository. */
import * as THREE from '/vendor/three/build/three.module.js';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

const MODEL = '/models/nova.glb';
const LOOK = { hair: [206, 164, 96], eyes: [62, 122, 74], top: [22, 22, 24], bottom: [46, 82, 138], shoes: [28, 28, 30] };
const MAP = {
  hips: 'Bip01_Pelvis', spine: 'Bip01_Spine', chest: 'Bip01_Spine1', upper: 'Bip01_Spine2',
  head: 'Bip01_Head', jaw: 'Bip01_MJaw',
  clavL: 'Bip01_L_Clavicle', clavR: 'Bip01_R_Clavicle',
  eyeL: 'Bip01_LEye', eyeR: 'Bip01_REye',
  leftUpperArm: 'Bip01_L_UpperArm', leftLowerArm: 'Bip01_L_Forearm',
  rightUpperArm: 'Bip01_R_UpperArm', rightLowerArm: 'Bip01_R_Forearm',
  leftUpperLeg: 'Bip01_L_Thigh', leftLowerLeg: 'Bip01_L_Calf',
  rightUpperLeg: 'Bip01_R_Thigh', rightLowerLeg: 'Bip01_R_Calf',
  blinkL: 'Bip01_LEyeBlinkTop', blinkR: 'Bip01_REyeBlinkTop',
};

const rest = new Map();
const posed = {};
const originals = new Map();
const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0.8 };
let model = null, renderer = null, scene = null, camera = null, raf = 0, last = 0, acc = 0;
let failed = '', colorsOn = true, clip = null, blinkAt = -10, nextBlink = 1.8;
let frames = 0, lastRender = 0, gaps = [];

const stageEl = () => document.getElementById('stage');
const canvasEl = () => document.getElementById('view');
function bone(name) {
  const raw = MAP[name] || name;
  if (!model) return null;
  return model.getObjectByName(raw) || model.getObjectByName(String(raw).replace(/_/g, ' '));
}
const smooth = (u) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); };
function noise(t, seed) {
  const s = seed || 0;
  return Math.sin(t * 0.23 + s) * 0.42 + Math.sin(t * 0.51 + s * 1.7) * 0.28
    + Math.sin(t * 0.11 + s * 2.4) * 0.18 + Math.sin(t * 0.87 + s * 0.6) * 0.12;
}
function fail(msg) {
  failed = msg;
  const el = document.getElementById('fail');
  if (el) { el.hidden = false; el.textContent = msg; }
  const c = canvasEl(); if (c) c.hidden = true;
}
function remember() {
  rest.clear();
  Object.keys(MAP).forEach((name) => { const n = bone(name); if (n) rest.set(name, n.quaternion.clone()); });
}
function applyBone(name, x, y, z) {
  const n = bone(name), q0 = rest.get(name); if (!n || !q0) return;
  n.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x || 0, y || 0, z || 0)));
}
function resetBones() { rest.forEach((q, name) => { const n = bone(name); if (n) n.quaternion.copy(q); }); }
function childNamed(n, re) {
  let child = null;
  n.traverse((c) => { if (!child && c !== n && re.test(c.name || '')) child = c; });
  return child;
}
function aimChild(n, child, target) {
  if (!n || !child) return;
  n.updateWorldMatrix(true, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  n.getWorldPosition(a);
  child.getWorldPosition(b);
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
function fitModel() {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(1.68 / Math.max(0.01, size.y));
  model.updateWorldMatrix(true, true);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;
}
function frameCamera() {
  if (!camera || !model) return;
  const st = stageEl();
  const w = Math.max(2, st.clientWidth), h = Math.max(2, st.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fov = camera.fov * Math.PI / 180;
  const fitH = (size.y / 2) / Math.tan(fov / 2);
  const fitW = (size.x / 2) / (Math.tan(fov / 2) * camera.aspect);
  const dist = Math.max(fitH, fitW) * 1.22;
  camera.position.set(center.x, center.y, box.max.z + dist);
  camera.lookAt(center.x, center.y, center.z);
}
function clampByte(n) { return n < 0 ? 0 : n > 255 ? 255 : n | 0; }
function cloth(r, g, b, target) {
  const s = 0.42 + ((r + g + b) / 3) / 170;
  return [clampByte(target[0] * s), clampByte(target[1] * s), clampByte(target[2] * s)];
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
  if (r > 80 && g > 45 && b > 30 && r > g - 8 && g + 8 >= b && r > b + 12 && r < 250 && b < 210) return 'skin';
  if (mx < 72 && mx - mn < 18 && b <= r + 4) return 'shoes';
  if (mx - mn < 48 && mx > 90) return 'top';
  return 'other';
}
function paintBuffer(src, kind) {
  const out = new Uint8ClampedArray(src.data);
  const w = src.width;
  for (let i = 0, p = 0; i < out.length; i += 4, p++) {
    const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2], a = src.data[i + 3];
    if (kind === 'opacity') {
      if (a < 8) continue;
      const h = hairTint(r, g, b, LOOK.hair);
      out[i] = h[0]; out[i + 1] = h[1]; out[i + 2] = h[2];
      continue;
    }
    if (kind === 'head') {
      const x = p % w, y = (p / w) | 0;
      if (y > 530 && x < 190 && r > 48 && r < 150 && g < r && b < 90 && r + g + b < 380) {
        const e = hairTint(r, g, b, LOOK.eyes);
        out[i] = e[0]; out[i + 1] = e[1]; out[i + 2] = e[2];
        continue;
      }
      if (Math.max(r, g, b) > 16 && !(r > 150 && g > 100 && b > 80) && r < 140 && r + 8 >= g && g + 12 >= b) {
        const h = hairTint(r, g, b, LOOK.hair);
        out[i] = h[0]; out[i + 1] = h[1]; out[i + 2] = h[2];
      }
      continue;
    }
    const bk = bodyKind(r, g, b);
    const c = bk === 'top' ? cloth(r, g, b, LOOK.top) : bk === 'bottom' ? cloth(r, g, b, LOOK.bottom) : bk === 'shoes' ? cloth(r, g, b, LOOK.shoes) : null;
    if (c) { out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; }
  }
  return new ImageData(out, src.width, src.height);
}
function paintColors(on) {
  colorsOn = !!on;
  if (!model) return;
  model.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach((m) => {
      if (!m) return;
      if (!on) {
        if (originals.has(m)) { m.map = originals.get(m); m.needsUpdate = true; }
        return;
      }
      if (!m.map) return;
      const name = m.name || '';
      const kind = /opacity/i.test(name) ? 'opacity' : /head/i.test(name) ? 'head' : /body/i.test(name) ? 'body' : '';
      if (!kind) return;
      if (!originals.has(m)) originals.set(m, m.map);
      const img = originals.get(m).image;
      if (!img || !img.width) return;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const painted = paintBuffer(ctx.getImageData(0, 0, c.width, c.height), kind);
      ctx.putImageData(painted, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = m.map.flipY;
      tex.needsUpdate = true;
      const prev = m.userData.paintTex;
      m.map = tex; m.userData.paintTex = tex; m.needsUpdate = true;
      if (prev && prev !== originals.get(m)) prev.dispose();
    });
  });
}
function stepGaze(t) {
  if (t >= gaze.next) {
    gaze.tx = noise(t, 8.2) * 0.06;
    gaze.ty = noise(t, 5.4) * 0.04;
    gaze.next = t + 1.8 + Math.abs(noise(t, 3.3)) * 2.4;
  }
  gaze.x += (gaze.tx - gaze.x) * 0.05;
  gaze.y += (gaze.ty - gaze.y) * 0.05;
}
function blinkAmt(t) {
  if (t >= nextBlink) { blinkAt = t; nextBlink = t + 2.6 + Math.abs(noise(t, 6.5)) * 3.2; }
  const u = (t - blinkAt) / 0.16;
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(u * Math.PI);
}
function idleOffsets(t) {
  const breath = 0.55 + 0.45 * noise(t * 0.72, 1.1);
  return {
    hips: [0.01 * noise(t, 2.2), 0.016 * noise(t, 1.4), 0.02 * noise(t, 4.1)],
    spine: [0.018 * breath, 0.01 * noise(t, 3.2), 0.012 * noise(t, 2.8)],
    chest: [0.028 * breath, 0, 0.01 * noise(t, 6.1)],
    upper: [0.012 * noise(t, 7.2), 0.008 * noise(t, 1.9), 0],
    head: [0.035 * noise(t, 2.6), 0.055 * noise(t, 1.2), 0.012 * noise(t, 4.4)],
    eyeL: [gaze.y, gaze.x, 0],
    eyeR: [gaze.y, gaze.x, 0],
    leftUpperArm: [0.012 * noise(t, 8.8), 0, 0.01 * noise(t, 3.7)],
    rightUpperArm: [0.012 * noise(t, 9.4), 0, -0.01 * noise(t, 3.7)],
  };
}
function waveOffsets(u) {
  const s = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI);
  const w = Math.sin(u * Math.PI * 4);
  return { rightUpperArm: [0.15, 0, -1.0 * s], rightLowerArm: [0, 0.1 * w * s, -0.85 * s] };
}
function blendBone(name, target, rate) {
  const c = posed[name] || [0, 0, 0];
  const n = [0, 1, 2].map((i) => c[i] + ((target[i] || 0) - c[i]) * rate);
  posed[name] = n;
  applyBone(name, n[0], n[1], n[2]);
}
function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!model) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now; acc += dt;
  if (acc < 1 / 30) return;
  frames += 1;
  if (lastRender && frames > 5) gaps.push(now - lastRender);
  if (gaps.length > 90) gaps.shift();
  lastRender = now;
  acc = 0;
  frameCamera();
  const t = now / 1000;
  stepGaze(t);
  resetBones();
  const idle = idleOffsets(t);
  let pose = {};
  if (clip) {
    const u = (now - clip.t0) / clip.dur;
    if (u >= 1) clip = null;
    else pose = waveOffsets(smooth(u));
  }
  const names = new Set([...Object.keys(idle), ...Object.keys(pose), ...Object.keys(posed)]);
  names.forEach((name) => {
    const a = idle[name] || [0, 0, 0], b = pose[name] || [0, 0, 0];
    blendBone(name, [a[0] + b[0], a[1] + b[1], a[2] + b[2]], clip ? 0.18 : 0.12);
  });
  const blink = blinkAmt(t) * 0.55;
  applyBone('blinkL', blink, 0, 0);
  applyBone('blinkR', blink, 0, 0);
  renderer.render(scene, camera);
}
function bodySpan() {
  const c = canvasEl();
  if (!c || !c.width) return null;
  const tmp = document.createElement('canvas');
  tmp.width = c.width; tmp.height = c.height;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(c, 0, 0);
  const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
  let top = -1, bot = -1;
  const w = tmp.width, h = tmp.height;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 6) {
      const i = (y * w + x) * 4;
      const d = Math.abs(data[i] - 232) + Math.abs(data[i + 1] - 235) + Math.abs(data[i + 2] - 240);
      if (d > 36) { if (top < 0) top = y; bot = y; break; }
    }
  }
  return { top: top / h, bot: bot / h, frames };
}
async function start() {
  const c = canvasEl();
  if (!window.WebGLRenderingContext) { fail('WebGL non disponibile su questo browser. La foto di Nova non è stata toccata.'); return; }
  try {
    renderer = new THREE.WebGLRenderer({ canvas: c, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  } catch (e) {
    fail('WebGL non si avvia (' + ((e && e.message) || 'errore') + '). La foto di Nova non è stata toccata.');
    return;
  }
  renderer.setClearColor(0xe8ebf0, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);
  scene.add(new THREE.HemisphereLight(0xfff6ee, 0xb7c0c8, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(0.5, 1.6, 1.5);
  scene.add(key);
  try {
    const gltf = await new GLTFLoader().loadAsync(MODEL);
    model = gltf.scene;
    model.traverse((o) => { o.frustumCulled = false; });
    scene.add(model);
    dropArms();
    fitModel();
    remember();
    paintColors(true);
  } catch (e) {
    fail('Modello 3D non caricato (' + ((e && e.message) || 'errore') + '). Resta solo questo avviso.');
    return;
  }
  raf = requestAnimationFrame(frame);
}
function wave() {
  if (!model || clip) return false;
  clip = { t0: performance.now(), dur: 2200 };
  return true;
}

document.getElementById('wave').addEventListener('click', wave);
document.getElementById('colors').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
  paintColors(on);
});
document.getElementById('full').addEventListener('click', (e) => {
  const on = !document.body.classList.contains('full');
  document.body.classList.toggle('full', on);
  e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
  e.currentTarget.textContent = on ? 'Riduci' : 'Ingrandisci';
  frameCamera();
});
window.addEventListener('resize', frameCamera);

window.Proto3D = {
  ready: () => !!model,
  failed: () => failed,
  sample: () => ({
    head: (posed.head || [0, 0, 0]).slice(),
    chest: (posed.chest || [0, 0, 0]).slice(),
    arm: (posed.rightUpperArm || [0, 0, 0]).slice(),
    waving: !!clip,
  }),
  stats: () => {
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    return { frames, avgMs: avg, maxMs: gaps.length ? Math.max(...gaps) : 0 };
  },
  span: bodySpan,
  wave,
  hang: () => {
    const out = [];
    ['leftUpperArm', 'rightUpperArm'].forEach((name) => {
      const n = bone(name); if (!n) return;
      const fore = childNamed(n, /Forearm/); if (!fore) return;
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      n.updateWorldMatrix(true, true);
      n.getWorldPosition(a); fore.getWorldPosition(b);
      out.push(b.y - a.y);
    });
    return out;
  },
};
start();
