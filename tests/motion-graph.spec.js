const { test, expect } = require('@playwright/test');
const G = require('../public/js/motion-graph.js');

// v2d-30: grafo delle pose. Logica pura, senza browser.
const u = (n) => '/api/motion/' + String(n).padStart(16, '0') + '.mp4';
const LIB = G.libraryOf({ motionClips: [
  { id: 'e', url: u(1), from: 'petto', to: 'petto', mood: ['vivace', 'allegra'] },
  { id: 'd', url: u(2), from: 'petto', to: 'petto', mood: ['calma'] },
  { id: 'p2g', url: u(3), from: 'petto', to: 'giu' },
  { id: 'g', url: u(4), from: 'giu', to: 'giu', mood: ['calma'] },
  { id: 'g2f', url: u(5), from: 'giu', to: 'fianco' },
  { id: 'f2p', url: u(6), from: 'fianco', to: 'petto' },
  { id: 'starnuto', url: u(7), kind: 'event', event: 'starnuto', from: 'giu', to: 'giu' },
  { id: 'parla', url: u(8), kind: 'parla', from: 'petto', to: 'petto' },
] });
function seq(r) { let i = 0; return () => r[i++ % r.length]; }

test('ogni clip parte dalla posa in cui è finito il precedente', () => {
  const st = G.createState();
  let rnd = 137;
  const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const { clip } = G.pickNext(LIB, st, { now: i * 8000, rand });
    expect(clip).toBeTruthy();
    expect(clip.from).toBe(st.pose);
    expect(clip.kind).not.toBe('parla');
    expect(clip.kind).not.toBe('event');
    G.commit(st, clip); seen.add(clip.to);
  }
  // le mani si spostano: si visitano tutte le pose
  expect([...seen].sort()).toEqual(['fianco', 'giu', 'petto']);
});

test('non ripete subito lo stesso clip e l\'umore sposta la scelta', () => {
  const lib = LIB.filter((c) => c.from === 'petto' && c.to === 'petto' && c.kind === 'base');
  const count = (mood) => {
    const st = G.createState(); st.mood = mood; st.moodUntil = 1e12;
    const n = { e: 0, d: 0 }; let last = null, repeats = 0;
    let x = 31; const rand = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    for (let i = 0; i < 300; i++) { const { clip } = G.pickNext(lib, st, { now: i, rand }); n[clip.id]++; if (clip.id === last) repeats++; last = clip.id; G.commit(st, clip); }
    return { ...n, repeats };
  };
  const happy = count('allegra'), calm = count('calma');
  expect(happy.e).toBeGreaterThan(happy.d);
  expect(calm.d).toBeGreaterThan(calm.e);
  expect(happy.repeats).toBeLessThan(150);
});

test('un evento parte appena possibile: prima il percorso fino alla sua posa, poi una volta sola', () => {
  const st = G.createState(); st.event = 'starnuto'; st.eventUntil = 1e12;
  const a = G.pickNext(LIB, st, { now: 1, rand: seq([0.5]) });
  expect(a.clip.id).toBe('p2g'); expect(a.why).toBe('verso-evento'); G.commit(st, a.clip);
  const b = G.pickNext(LIB, st, { now: 2, rand: seq([0.5]) });
  expect(b.clip.id).toBe('starnuto'); G.commit(st, b.clip);
  expect(st.event).toBe(null);
  const c = G.pickNext(LIB, st, { now: 3, rand: seq([0.5]) });
  expect(c.clip.kind).not.toBe('event');
});

test('quando sta per parlare torna alla posa della foto per la strada più corta', () => {
  const st = G.createState(); st.pose = 'giu';
  const a = G.pickNext(LIB, st, { now: 1, home: true, rand: seq([0.9]) });
  expect(a.clip.id).toBe('g2f'); G.commit(st, a.clip);
  const b = G.pickNext(LIB, st, { now: 2, home: true, rand: seq([0.9]) });
  expect(b.clip.id).toBe('f2p'); G.commit(st, b.clip);
  for (let i = 0; i < 20; i++) { const c = G.pickNext(LIB, st, { now: 3 + i, home: true, rand: Math.random }); expect(c.clip.to).toBe('petto'); G.commit(st, c.clip); }
});

test('clip del parlato solo se richiesti; vecchio motionVideo ancora valido; eventi e umori dal testo', () => {
  const st = G.createState();
  const t = G.pickNext(LIB, st, { now: 1, talk: true, rand: seq([0.5]) });
  expect(t.clip.id).toBe('parla');
  const legacy = G.libraryOf({ motionVideo: u(9) });
  expect(legacy.length).toBe(1); expect(legacy[0].from).toBe('petto');
  expect(G.libraryOf({ motionClips: [{ url: '/etc/passwd' }, { url: u(1), from: '../x' }] })).toEqual([expect.objectContaining({ from: 'petto' })]);
  expect(G.eventFromText('Etciù! scusami')).toBe('starnuto');
  expect(G.eventFromText('ahahah mi fai morire')).toBe('ride');
  expect(G.eventFromText('[gesto: annuisce] va bene')).toBe('annuisce');
  expect(G.eventFromText('ok va bene')).toBe(null);
  expect(G.moodFromText('[umore: tenera] ciao')).toBe('affettuosa');
  expect(G.moodFromText('che bello!! 😄')).toBe('allegra');
  expect(G.moodFromText('mmm forse hai ragione, chissà')).toBe('pensierosa');
  expect(G.moodFromText('Va bene.')).toBe('calma');
});
