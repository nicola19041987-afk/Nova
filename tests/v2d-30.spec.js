const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

// v2d-30: movimento continuo. I clip si incatenano senza fermo immagine (due video, dissolvenza breve),
// l'umore e gli eventi del discorso scelgono il prossimo clip, mentre parla resta la foto col labiale.
const FACE = '/api/avatars/b10b1a0000000001.jpg';
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda-landmarks.json'), 'utf8'));
const DIR = process.env.NOVA_CLIPS || '/tmp/v30clips'; // clip privati: solo in locale, non nel repo
const FILES = { 'e000000000000001': 'base-petto-e-vivace-2s.mp4', 'd000000000000002': 'base-petto-d-calma-2s.mp4', 'a000000000000003': 'old-nova-ascolta-v2-2s.mp4' };
const OUT = process.env.NOVA_EVIDENCE || '/opt/cursor/artifacts';
const url = (k) => `/api/motion/${k}.mp4`;
const CLIPS = [
  { id: 'e1', url: url('e000000000000001'), kind: 'base', from: 'petto', to: 'petto', mood: ['vivace', 'allegra'] },
  { id: 'd1', url: url('d000000000000002'), kind: 'base', from: 'petto', to: 'petto', mood: ['calma'] },
  { id: 'starnuto', url: url('a000000000000003'), kind: 'event', event: 'starnuto', from: 'petto', to: 'petto' },
];

async function mock(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    const m = /^\/api\/motion\/([a-f0-9]{16})\.mp4$/.exec(p);
    if (m && FILES[m[1]]) return route.fulfill({ status: 200, contentType: 'video/mp4', path: path.join(DIR, FILES[m[1]]) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Nova', ready: 'nova-bionda', avatar: FACE, motionClips: CLIPS, personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/actions') return json([]);
    if (p === '/api/gestures') return json([]);
    return json({});
  });
}

test('i clip si incatenano senza buchi, umore ed eventi scelgono il successivo, la voce torna alla foto', async ({ page }, testInfo) => {
  test.skip(!Object.values(FILES).every((f) => fs.existsSync(path.join(DIR, f))), 'clip di prova solo in locale');
  test.setTimeout(90000);
  const dir = path.join(OUT, 'v2d-30-' + testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await mock(page);
  await page.goto('/');
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#wa-photo').click();
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 15000 });
  await page.evaluate(() => App.motionPlayer.mood('allegra'));

  // ~7 s di campioni: sempre un video visibile che avanza, almeno 3 passaggi
  const samples = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 7000) {
      await new Promise((r) => setTimeout(r, 40));
      const vs = ['motion-video', 'motion-video-b'].map((id) => document.getElementById(id));
      const vis = vs.filter((v) => getComputedStyle(v).display !== 'none' && Number(getComputedStyle(v).opacity) > 0.9);
      const P = App.motionPlayer; const f = P.els[P.cur];
      out.push({ t: performance.now() - t0, motion: document.getElementById('stage').classList.contains('has-motion'), vis: vis.length, front: f.id, ct: f.currentTime, paused: f.paused, n: P.log.length });
    }
    return out;
  });
  expect(samples.every((s) => s.motion)).toBe(true);
  expect(samples.every((s) => s.vis >= 1)).toBe(true);
  const swaps = samples[samples.length - 1].n - samples[0].n;
  expect(swaps).toBeGreaterThanOrEqual(2);
  // nessun fermo immagine oltre 400 ms: il tempo del video in primo piano avanza sempre
  let still = 0, worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.front === b.front && Math.abs(b.ct - a.ct) < 1e-3) still += b.t - a.t; else still = 0;
    worst = Math.max(worst, still);
  }
  expect(worst).toBeLessThan(400);
  const log1 = await page.evaluate(() => App.motionPlayer.log.slice());
  for (let i = 1; i < log1.length; i++) expect(log1[i].from).toBe(log1[i - 1].to);
  fs.writeFileSync(path.join(dir, 'chain.json'), JSON.stringify({ worstStillMs: Math.round(worst), swaps, log: log1 }, null, 2));
  await page.locator('#stage').screenshot({ path: path.join(dir, '01-chain.png') });

  // evento dal discorso: «etciù» -> clip dello starnuto appena finisce quello in corso
  await page.evaluate(() => App.chat.motionHear('Etciù! scusami', false));
  await page.waitForFunction(() => App.motionPlayer.log.some((l) => l.id === 'starnuto'), null, { timeout: 8000 });
  await page.waitForFunction(() => { const l = App.motionPlayer.log; return l[l.length - 1].id !== 'starnuto'; }, null, { timeout: 8000 });

  // i file sono già in cache sul telefono
  const cached = await page.evaluate(async () => (await (await caches.open('nova-motion-v1')).keys()).map((r) => new URL(r.url).pathname));
  expect(cached.length).toBe(3);

  // mentre parla: dissolvenza alla foto col labiale, il video non riparte finché parla
  await page.evaluate(() => App.avatarConv.speakLive(() => 0.5 + 0.45 * Math.sin(performance.now() / 70), () => 0.5));
  await page.waitForFunction(() => !document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 2000 });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('avatar-canvas')).visibility)).toBe('visible');
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => document.getElementById('stage').classList.contains('has-motion'))).toBe(false);
  await page.evaluate(() => App.avatarConv.stopAudio());
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 12000 });
  expect(await page.evaluate(() => App.motionPlayer.st.pose)).toBe('petto');
});

test('libreria dei clip: solo il proprietario aggiunge e toglie, pose e umori ripuliti', async ({ request }) => {
  const HEAD = { 'X-Requested-With': 'app-privata' };
  const mp4 = () => { const b = Buffer.alloc(32); b.writeUInt32BE(24, 0); b.write('ftyp', 4, 4, 'ascii'); b.write('isom', 8, 4, 'ascii'); return b; };
  const CH = '5ce17a0000000001';
  const bare = await request.post(`/api/characters/${CH}/motion-clips`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: mp4() });
  expect(bare.status()).toBe(401);
  for (const [user, pin] of [['luisa', '2468'], ['nicola', '1357']]) {
    const s = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
    if (s.status() === 409) expect((await request.post('/api/login', { data: { user, pin }, headers: HEAD })).ok()).toBeTruthy();
    else expect(s.ok(), await s.text()).toBeTruthy();
  }
  // ora la sessione è di Nicola (proprietario)
  const bad = await request.post(`/api/characters/${CH}/motion-clips`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: Buffer.from('nope') });
  expect(bad.status()).toBe(400);
  const noEv = await request.post(`/api/characters/${CH}/motion-clips?kind=event`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: mp4() });
  expect(noEv.status()).toBe(400);
  const up = await request.post(`/api/characters/${CH}/motion-clips?kind=move&from=petto&to=giu&mood=calma,../x,allegra&label=prova`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: mp4() });
  expect(up.ok(), await up.text()).toBeTruthy();
  const { clip } = await up.json();
  expect(clip).toMatchObject({ kind: 'move', from: 'petto', to: 'giu', mood: ['calma', 'allegra'], label: 'prova' });
  expect(clip.url).toMatch(/^\/api\/motion\/[a-f0-9]{16}\.mp4$/);
  const ev = await request.post(`/api/characters/${CH}/motion-clips?kind=event&event=starnuto&from=../../etc`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: mp4() });
  expect((await ev.json()).clip).toMatchObject({ kind: 'event', event: 'starnuto', from: 'petto', to: 'petto' });
  const list = await (await request.get(`/api/characters/${CH}/motion-clips`)).json();
  expect(list.clips.length).toBe(2);
  const chars = await (await request.get('/api/characters')).json();
  expect(chars.find((c) => c.id === CH).motionClips.length).toBe(2);
  const head = await request.get(clip.url, { headers: { Range: 'bytes=0-3' } });
  expect(head.status()).toBe(206);
  // Luisa non gestisce la libreria di Nicola
  expect((await request.post('/api/login', { data: { user: 'luisa', pin: '2468' }, headers: HEAD })).ok()).toBeTruthy();
  expect((await request.delete(`/api/characters/${CH}/motion-clips/${clip.id}`, { headers: HEAD })).status()).toBe(403);
  expect((await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD })).ok()).toBeTruthy();
  const del = await request.delete(`/api/characters/${CH}/motion-clips/${clip.id}`, { headers: HEAD });
  expect(del.ok()).toBeTruthy();
  expect((await del.json()).count).toBe(1);
});
