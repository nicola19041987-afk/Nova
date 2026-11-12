const { test, expect } = require('./harness');

test('il video idle si muove mentre parla e resta fermo se il movimento è ridotto', async ({ page }) => {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.goto('/');
  await page.waitForFunction(() => window.LiveMotion && window.MotionLib && window.App && App.avatarConv && document.getElementById('motion-video'));
  await expect(page.locator('label.switch:has(#set-content-filter)')).toContainText('Filtro contenuti espliciti');
  await expect(page.locator('#content-filter-note')).toHaveText('Vale solo per il profilo con cui hai fatto l\'accesso.');
  await expect(page.locator('#set-content-filter')).toBeChecked();
  const moved = await page.evaluate(() => {
    const v = document.getElementById('motion-video');
    const stage = document.getElementById('stage');
    document.body.classList.add('solo-mode', 'in-call');
    stage.classList.add('call', 'has-motion');
    v.hidden = false;
    App.avatarConv.speaking = true;
    App.avatarConv.mouth = 0.85;
    LiveMotion.tick(1200);
    LiveMotion.tick(1900);
    const listen = MotionLib.createDrive();
    const speak = MotionLib.createDrive();
    let a = 0;
    let b = 0;
    let now = 3000;
    for (let i = 0; i < 16; i++) {
      now += 360;
      const L = MotionLib.cssPose(MotionLib.drive(listen, now, 360, LiveMotion.energy.call ? 0.14 : 0.14));
      const S = MotionLib.cssPose(MotionLib.drive(speak, now, 360, 0.9));
      a += Math.abs(L.y) + Math.abs(L.rot);
      b += Math.abs(S.y) + Math.abs(S.rot);
    }
    return { transform: v.style.transform, speak: b, listen: a };
  });
  expect(moved.transform).toContain('translate3d');
  expect(moved.transform).toContain('scale(');
  expect(moved.speak).toBeGreaterThan(moved.listen);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page.evaluate(() => {
    LiveMotion.tick(2400);
    return {
      transform: document.getElementById('motion-video').style.transform,
      reduced: LiveMotion.reduced(),
    };
  });
  expect(still.reduced).toBe(true);
  expect(still.transform).toBe('');
});
