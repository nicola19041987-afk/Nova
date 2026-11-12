const { test, expect } = require('./harness');

test('la cornice del video idle resta ferma, anche mentre parla e con movimento ridotto', async ({ page }) => {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.goto('/');
  await page.waitForFunction(() => window.LiveMotion && window.MotionLib && window.App && App.avatarConv && document.getElementById('motion-video'));
  await expect(page.locator('label.switch:has(#set-content-filter)')).toContainText('Filtro contenuti espliciti');
  await expect(page.locator('#content-filter-note')).toHaveText('Vale solo per il profilo con cui hai fatto l\'accesso.');
  await expect(page.locator('#set-content-filter')).toBeChecked();
  // v2d-29: la cornice del video idle e del ritratto in chiamata non trasla, non ruota e non si ingrandisce più.
  const moved = await page.evaluate(() => {
    const v = document.getElementById('motion-video');
    const stage = document.getElementById('stage');
    document.body.classList.add('solo-mode', 'in-call');
    stage.classList.add('call', 'has-motion');
    v.hidden = false;
    v.style.transform = 'translate3d(9px,9px,0)';
    App.avatarConv.speaking = true;
    App.avatarConv.mouth = 0.85;
    const out = [];
    for (const t of [1200, 1900, 2600, 3300]) { LiveMotion.tick(t); out.push(v.style.transform); }
    return { transforms: out, energy: LiveMotion.energy() };
  });
  expect(moved.transforms.every((t) => t === '')).toBe(true);
  expect(moved.energy).toBeGreaterThan(0.5);

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
