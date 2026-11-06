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
