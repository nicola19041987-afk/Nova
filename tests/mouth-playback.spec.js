const { test, expect } = require('./harness');

test('la bocca si apre su tutti i percorsi anche se l’audio non dà un livello', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.id = 'mouth-probe';
    c.style.cssText = 'position:fixed;left:0;top:0;width:180px;height:180px';
    document.body.appendChild(c);
    const av = new TalkingAvatar(c);
    const run = (n) => {
      let now = performance.now(), max = 0;
      for (let i = 0; i < n; i++) { now += 32; av._drawn = 0; av.frame(now); max = Math.max(max, av.mouth); }
      return max;
    };
    av.speakLive(() => 0.02, () => 0);
    const live = run(24);
    av.stopAudio();
    const paused = { paused: true, ended: false, currentTime: 0 };
    av.speakAudio(paused, null, 'Ciao Nova, come va la tua giornata?');
    const tts = run(24);
    av.stopAudio();
    const stuck = { paused: false, ended: false, currentTime: 0 };
    av.speakAudio(stuck, new Float32Array(40), 'Questa frase ha un inviluppo tutto a zero');
    const env = run(24);
    av.stopAudio();
    const u = { rate: 1, addEventListener() {} };
    av.speakUtterance(u, 'Pronto mi senti senza l evento start');
    const synth = run(24);
    c.remove();
    return { live, tts, env, synth };
  });
  expect(r.live).toBeGreaterThan(0.15);
  expect(r.tts).toBeGreaterThan(0.15);
  expect(r.env).toBeGreaterThan(0.15);
  expect(r.synth).toBeGreaterThan(0.15);
});
