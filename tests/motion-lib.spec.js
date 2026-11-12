const { test, expect } = require('./harness');
const lib = require('../public/js/motion-lib');

test('la libreria ha almeno 509 movimenti con nomi unici', () => {
  expect(lib.count).toBeGreaterThanOrEqual(509);
  expect(lib.PRESETS.length).toBe(lib.count);
  const names = new Set(lib.PRESETS.map((p) => p.name));
  const ids = new Set(lib.PRESETS.map((p) => p.id));
  expect(names.size).toBe(lib.count);
  expect(ids.size).toBe(lib.count);
  const bad = /nudo|lingerie|erot|sessual|spogli/i;
  expect(lib.PRESETS.some((p) => bad.test(p.name))).toBe(false);
  const a = lib.pick('idle', 1000, []);
  const b = lib.pick('idle', 1000, [a.id]);
  expect(b.id).not.toBe(a.id);
  expect(lib.pick('speak', 50, []).groups).toContain('speak');
  expect(lib.pick('sad', 50, []).groups).toContain('sad');
  const think = lib.get('sguardo-alto-media-naturale-media');
  expect(think.gazeX).toBeGreaterThan(0.3);
  expect(think.gazeY).toBeLessThan(0);
  const listen = lib.get('ascolto-media-naturale-media');
  const nod = lib.get('cenno-si-media-naturale-media');
  expect(Math.abs(listen.sway)).toBeLessThan(Math.abs(nod.sway) + 0.02);
  expect(listen.sway).toBeLessThan(0.005);
});

test('il movimento procedurale varia, è più vivo mentre parla e non rimpicciolisce', () => {
  const run = (energy) => {
    const s = lib.createDrive();
    const poses = [];
    let now = 1000;
    for (let i = 0; i < 24; i++) {
      now += 420;
      poses.push(lib.drive(s, now, 420, energy));
    }
    return poses;
  };
  const speak = run(0.9);
  const calm = run(0.12);
  const ids = speak.map((p) => p.id);
  expect(new Set(ids).size).toBeGreaterThan(2);
  let runLen = 1;
  let maxRun = 1;
  for (let i = 1; i < ids.length; i++) {
    runLen = ids[i] === ids[i - 1] ? runLen + 1 : 1;
    if (runLen > maxRun) maxRun = runLen;
  }
  expect(maxRun).toBeLessThan(8);
  const amp = (list) => list.reduce((n, p) => n + Math.abs(p.y) + Math.abs(p.rot) + Math.abs(p.shoulder), 0) / list.length;
  expect(amp(speak)).toBeGreaterThan(amp(calm));
  for (const p of speak.concat(calm)) {
    const css = lib.cssPose(p);
    expect(css.scale).toBeGreaterThanOrEqual(1);
    expect(css.scale).toBeLessThanOrEqual(1.028);
    expect(Math.abs(css.rot)).toBeLessThanOrEqual(1.35);
  }
  const a = lib.cssTransform(speak[8]);
  const b = lib.cssTransform(speak[20]);
  expect(a).toContain('translate3d');
  expect(a).not.toBe(b);
});

test('la mano non resta alzata: il gesto dura pochi secondi e torna neutro', () => {
  const s = lib.createHand();
  let now = 1000;
  let maxGo = 0;
  let goStart = 0;
  let sawLift = false;
  let back = false;
  let sides = new Set();
  const idles = [];
  for (let i = 0; i < 80; i++) {
    now += 250;
    const p = lib.stepHand(s, now);
    sides.add(p.side);
    if (p.phase === 'go') {
      if (!goStart) goStart = now;
      maxGo = Math.max(maxGo, now - goStart);
      if (p.lift > 0.8) sawLift = true;
      expect(p.msLeft).toBeLessThanOrEqual(lib.HAND_PLAY_MS);
    } else {
      goStart = 0;
      expect(p.lift).toBe(0);
      if (sawLift) back = true;
      idles.push(p.idle);
    }
  }
  expect(sawLift).toBe(true);
  expect(back).toBe(true);
  expect(maxGo).toBeLessThanOrEqual(lib.HAND_PLAY_MS);
  expect(sides.size).toBe(2);
  const varied = new Set(idles.map((n) => n.toFixed(2))).size;
  expect(varied).toBeGreaterThan(2);
});

test('il video idle non resta in loop: un tratto breve, poi la foto', () => {
  const s = lib.createClipPlay();
  let now = 0;
  const first = lib.stepClipPlay(s, now, 20000);
  expect(first.play).toBe(false);
  now = 500;
  const play = lib.stepClipPlay(s, now, 20000);
  expect(play.play).toBe(true);
  expect(play.seek).toBeGreaterThan(0);
  const mid = lib.stepClipPlay(s, now + 1000, 20000);
  expect(mid.play).toBe(true);
  expect(mid.seek).toBe(null);
  const done = lib.stepClipPlay(s, now + lib.CLIP_PLAY_MS, 20000);
  expect(done.play).toBe(false);
});
