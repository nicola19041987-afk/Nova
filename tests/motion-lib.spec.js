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
