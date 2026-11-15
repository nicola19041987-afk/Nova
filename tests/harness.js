const pw = require('@playwright/test');

const test = pw.test.extend({
  e2eReset: [async ({ request }, use) => {
    const r = await request.post('/api/e2e/reset-login-limit', {
      headers: { 'X-Requested-With': 'app-privata' },
    });
    if (!r.ok()) throw new Error('reset limite: ' + await r.text());
    await use();
  }, { auto: true }],
});

module.exports = { test, expect: pw.expect, request: pw.request };

// v2d-46: di serie il volto è SEMPRE la foto scelta (niente scene/vestiti/gesti/clip di altre foto). I test che verificano
// proprio quei meccanismi (rimasti nel codice) li riaccendono su questo telefono con faceLock='0'.
async function scenesOn(page) {
  await page.addInitScript(() => {
    const g = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { return /:faceLock$/.test(String(k)) ? '"0"' : g.call(this, k); };
  });
}
module.exports.scenesOn = scenesOn;
