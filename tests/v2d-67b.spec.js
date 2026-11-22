const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('v2d-67b: il codice non avvia Simli prima del luogo e tiene Simli muto', () => {
  const call = read('public/js/call.js');
  const simli = read('public/js/simli.js');
  const css = read('public/style.css');
  const sw = read('public/sw.js');

  expect(call).toContain('function locationBlocksSimli()');
  const choose = call.indexOf('App.locationCall.onCallStart(wantMode)');
  const setMode = call.indexOf('setMode(wantMode)');
  const stop = call.indexOf('if (App.simli && locationBlocksSimli()) App.simli.stop()');
  expect(choose).toBeGreaterThan(0);
  expect(setMode).toBeGreaterThan(choose);
  expect(stop).toBeGreaterThan(setMode);
  expect(call).toContain('const locLayer = locationBlocksSimli()');

  expect(simli).toContain('function blockedByLocation()');
  expect(simli).toContain('connGen');
  expect(simli).toContain('if (stale()) return false');
  expect(simli).toContain('voiceFrom(false)');
  expect(simli).not.toMatch(/g\.connect\(c\.destination\)/);
  expect(simli).toContain('video.volume = 0');

  expect(css).toContain('#stage.loc-call #simli-video');
  expect(sw).toContain("CACHE = 'app-privata-v2d-67b'");
});
