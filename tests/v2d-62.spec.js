// v2d-62: viso ufficiale Ira, videochiamata nello showroom con inquadratura viso+spalle,
// etichette in alto a destra (mai sul viso), chat visivamente vuota (messaggi conservati),
// richieste Grok/avvisi sistema non disegnate.
const { test, expect } = require('./harness');
const path = require('path');
const fs = require('fs');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOT = '/workspace/ira-schermate-attuali';
const IRA = '5ce17a0000000001';
const NEW_AV = '/api/avatars/c2d6200000000001.jpg';
const OLD_AV = ['a1fa460000000001', 'alpha-foto-v46', 'alpha-foto'];

async function loginNicola(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
}

async function disableSw(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
}

const vis = () => {
  const visId = (id) => {
    const el = document.getElementById(id);
    if (!el || el.hidden) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 0 && r.height > 0;
  };
  return visId;
};

test('v2d-62: cache, viso ufficiale, chat visivamente vuota, niente richieste Grok in vista, videochiamata showroom', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Stesso percorso verificato su Chromium (390x844).');
  fs.mkdirSync(SHOT, { recursive: true });

  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(62|63|64|65|65b)'/);
  expect(sw).toContain('/js/location-call.js');
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-61'");

  await loginNicola(page);
  const list = await (await page.request.get('/api/characters', { headers: HEAD })).json();
  const ira = (Array.isArray(list) ? list : list.characters || []).find((c) => c && (c.id === IRA || c.ready === 'nova-scelta'));
  expect(ira, 'scheda Ira presente').toBeTruthy();
  expect(ira.avatar).toBe(NEW_AV);
  expect(String(ira.avatar)).not.toMatch(/a1fa460000000001|alpha-foto/);
  expect(ira.landmarks == null || !ira.landmarks.mouth).toBe(true);

  const loc = await (await page.request.get('/api/locations', { headers: HEAD })).json();
  expect(loc.default).toBe('showroom');
  const show = (loc.places || []).find((p) => p.id === 'showroom');
  expect(show && show.ready).toBe(true);
  const pack = await (await page.request.get('/api/locations/showroom', { headers: HEAD })).json();
  expect(pack.still).toBe('/api/locations/showroom/still');
  expect((pack.clips || []).length).toBeGreaterThanOrEqual(4);
  expect((pack.clips || []).some((c) => c.kind === 'parla')).toBe(true);

  const forbidden = [];
  page.on('request', (req) => {
    const u = req.url();
    const m = req.method();
    if (/\/api\/(admin\/reset|wipe|chats\/[^/]+)$/.test(u) && (m === 'DELETE' || m === 'POST') && /wipe|reset/.test(u)) forbidden.push(m + ' ' + u);
    if (m === 'DELETE' && /\/api\/chats\//.test(u)) forbidden.push(m + ' ' + u);
    if (m === 'POST' && /\/api\/(admin\/reset|wipe)\b/.test(u)) forbidden.push(m + ' ' + u);
    if (m === 'POST' && /\/api\/chats\/[^/]+\/visible-from/.test(u)) forbidden.push(m + ' ' + u);
  });

  const oldAt = '2026-11-21T10:00:00.000Z';
  const leakBody = 'the call: sistema il tasto del microfono — [Steering message from Grok] CLOUDAGENT_PROMPT v2d-62';
  await page.route((u) => /\/api\/chats\//.test((u && u.pathname) || String(u)), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback();
    const url = req.url();
    if (/\/(sight|summarize|summary|visible-from|voice-turn)/.test(url)) return route.fallback();
    const res = await route.fetch();
    let data;
    try { data = await res.json(); } catch { return route.fulfill({ response: res }); }
    const extra = [
      { id: 'old-vis-1', n: 1, role: 'user', author: 'nicola', authorName: 'Nico', content: 'Messaggio vecchio da nascondere solo in vista', at: oldAt },
      { id: 'old-vis-2', n: 2, role: 'assistant', author: IRA, authorName: 'Ira', content: 'Risposta vecchia ancora sul disco', at: oldAt },
      { id: 'leak-grok-1', n: 3, role: 'system', author: 'sistema', authorName: 'Sistema', content: leakBody, at: new Date().toISOString(), extra: { source: 'webhook', notice: true } },
      { id: 'leak-grok-2', n: 4, role: 'user', author: 'grok', authorName: 'Grok', content: 'the call: Finish the Audi S3 showroom video now', at: new Date().toISOString() },
    ];
    data.messages = extra.concat(Array.isArray(data.messages) ? data.messages : []);
    if (typeof data.last !== 'number' || data.last < 4) data.last = 4;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });

  await disableSw(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.waitForSelector('#char-list li[data-id] img');

  const listShot = path.join(SHOT, 'v2d-62-lista-chat.png');
  await page.screenshot({ path: listShot, animations: 'disabled' });

  const av = await page.evaluate(() => {
    const img = document.querySelector('#char-list li[data-id] img');
    return { src: img && (img.getAttribute('data-src') || img.getAttribute('src') || ''), alt: img && img.alt };
  });
  expect(av.src).toContain('c2d6200000000001');
  for (const bad of OLD_AV) expect(av.src).not.toContain(bad);

  const iraRow = page.locator('#char-list li[data-id]').first();
  await iraRow.click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') || document.body.classList.contains('wa-conv') || (document.getElementById('tab-conv') && !document.getElementById('tab-conv').hidden));
  await page.waitForTimeout(300);

  const headerAv = await page.evaluate(() => {
    const img = document.querySelector('#wa-photo img, .wa-photo img, #wa-photo .wa-av img');
    const msgs = [...document.querySelectorAll('#messages .msg .body')].map((el) => el.textContent);
    const pills = [...document.querySelectorAll('#messages .day-pill')].map((el) => el.textContent);
    return {
      src: img && (img.getAttribute('data-src') || img.getAttribute('src') || ''),
      msgs,
      pills,
      msgCount: document.querySelectorAll('#messages .msg').length,
      from: window.App && App.chatView && App.chatView.from && App.chatView.from(),
    };
  });
  expect(headerAv.src).toContain('c2d6200000000001');
  for (const bad of OLD_AV) expect(headerAv.src).not.toContain(bad);
  expect(headerAv.msgCount).toBe(0);
  expect(headerAv.msgs.join('\n')).not.toMatch(/Messaggio vecchio|Risposta vecchia|Steering|CLOUDAGENT|the call:|Audi S3/i);

  const chatShot = path.join(SHOT, 'v2d-62-chat-ira.png');
  await page.screenshot({ path: chatShot, animations: 'disabled' });

  // I messaggi iniettati nella risposta API restano "presenti" lato client filter, non cancellati: nessun DELETE/wipe/reset/visible-from.
  expect(forbidden, 'nessuna cancellazione o visible-from server').toEqual([]);

  // Filtro visivo: un messaggio nuovo (dopo il taglio) si vede; un leak Grok no, anche se addMsg viene chiamato.
  const filter = await page.evaluate(() => {
    const shown = (m) => !!(App.chat.addMsg(m));
    const old = shown({ id: 't-old', role: 'user', author: 'nicola', content: 'ancora vecchio', at: '2026-01-01T00:00:00.000Z' });
    const leak = shown({ id: 't-leak', role: 'system', author: 'sistema', content: 'SISTEMA: richiesta di modifica dell\'app passata', at: new Date().toISOString(), extra: { source: 'webhook' } });
    const leak2 = shown({ id: 't-leak2', role: 'user', author: 'nicola', content: 'the call: sistema il microfono', at: new Date().toISOString() });
    const fresh = shown({ id: 't-new', role: 'assistant', author: '5ce17a0000000001', authorName: 'Ira', content: 'Ciao, sono qui adesso.', at: new Date().toISOString() });
    const texts = [...document.querySelectorAll('#messages .msg .body')].map((el) => el.textContent);
    // togliamo l'eventuale bolla di prova per lo screenshot pulito
    document.querySelectorAll('#messages .msg[data-id="t-new"]').forEach((el) => el.remove());
    return { old, leak, leak2, fresh: !!fresh, texts, hiddenOld: App.chatView.hidden({ at: '2026-01-01T00:00:00.000Z', content: 'x' }), leakFn: App.chatView.isAssistLeak({ role: 'system', content: 'x' }) };
  });
  expect(filter.old).toBe(false);
  expect(filter.leak).toBe(false);
  expect(filter.leak2).toBe(false);
  expect(filter.fresh).toBe(true);
  expect(filter.hiddenOld).toBe(true);
  expect(filter.leakFn).toBe(true);
  // ripulisci la chat per lo screenshot già fatto; se è rimasta la bolla nuova la togliamo già sopra

  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.mode === 'video');
  await page.waitForTimeout(800);

  const call = await page.evaluate(() => {
    const visId = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 0 && r.height > 0;
    };
    const stage = document.getElementById('stage');
    const st = getComputedStyle(stage);
    const box = (id) => {
      const el = document.getElementById(id) || document.querySelector(id);
      if (!el || el.hidden) return null;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, left: r.left, top: r.top };
    };
    const top = document.querySelector('.call-top');
    const topBox = top && getComputedStyle(top).display !== 'none' ? top.getBoundingClientRect() : null;
    const xBox = box('call-min');
    const face = { left: 390 * 0.18, right: 390 * 0.82, top: 844 * 0.16, bottom: 844 * 0.72 };
    const overlapsFace = (b) => b && !(b.right < face.left || b.left > face.right || b.bottom < face.top || b.top > face.bottom);
    const vids = [...document.querySelectorAll('#motion-video, #motion-video-b')].map((v) => ({
      src: v.currentSrc || v.src || v.getAttribute('src') || '',
      poster: v.getAttribute('poster') || '',
      w: v.getBoundingClientRect().width,
      h: v.getBoundingClientRect().height,
    }));
    const bg = st.backgroundImage || '';
    return {
      mode: App.call.mode,
      locOn: stage.classList.contains('loc-call'),
      place: App.locationCall && App.locationCall.place && App.locationCall.place(),
      still: App.locationCall && App.locationCall.still && App.locationCall.still(),
      zoom: st.getPropertyValue('--call-zoom').trim(),
      top: topBox && { x: topBox.x, y: topBox.y, w: topBox.width, h: topBox.height, right: topBox.right, left: topBox.left },
      x: xBox,
      state: box('call-state'),
      timer: box('call-timer'),
      kind: box('call-kind'),
      name: box('call-name'),
      badge: box('call-badge'),
      overlaps: {
        top: overlapsFace(topBox && { left: topBox.left, right: topBox.right, top: topBox.top, bottom: topBox.bottom }),
        state: overlapsFace(box('call-state')),
        timer: overlapsFace(box('call-timer')),
        kind: overlapsFace(box('call-kind')),
        name: overlapsFace(box('call-name')),
      },
      vids,
      bg,
      canvasSrc: (App.avatarConv && App.avatarConv.img && (App.avatarConv.img._src || App.avatarConv.img.src)) || '',
    };
  });

  expect(call.mode).toBe('video');
  expect(call.locOn).toBe(true);
  expect(call.place).toBe('showroom');
  expect(call.still).toBe('/api/locations/showroom/still');
  const zoom = parseFloat(call.zoom || '0');
  expect(zoom).toBeGreaterThanOrEqual(2.3);
  expect(zoom).toBeLessThanOrEqual(2.85);
  // etichette in alto a destra
  expect(call.top).toBeTruthy();
  expect(call.top.right).toBeGreaterThan(390 - 160);
  expect(call.top.left).toBeGreaterThan(390 * 0.55);
  expect(call.top.y).toBeLessThan(140);
  expect(call.x).toBeTruthy();
  expect(call.x.right).toBeGreaterThan(390 - 70);
  expect(call.x.top).toBeLessThan(80);
  expect(call.overlaps.top).toBe(false);
  expect(call.overlaps.state).toBe(false);
  expect(call.overlaps.timer).toBe(false);
  expect(call.overlaps.name).not.toBe(true);
  expect(call.overlaps.kind).not.toBe(true);
  const media = [call.bg, ...(call.vids || []).flatMap((v) => [v.src, v.poster]), call.canvasSrc].join('\n');
  expect(media).not.toMatch(/a1fa460000000001|alpha-foto-v46|alpha-foto/);
  expect(call.still + media).toMatch(/locations\/showroom/);
  const wide = (call.vids || []).some((v) => v.w > 390 * 1.6);
  expect(wide || zoom >= 2.3).toBe(true);

  const callShot = path.join(SHOT, 'v2d-62-videochiamata-apertura.png');
  await page.screenshot({ path: callShot, animations: 'disabled' });

  expect(forbidden).toEqual([]);
  expect(fs.existsSync(listShot) && fs.existsSync(chatShot) && fs.existsSync(callShot)).toBe(true);
});
