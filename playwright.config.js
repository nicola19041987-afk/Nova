const { defineConfig } = require('@playwright/test');

// v2d-44: i test locali non devono MAI usare i webhook veri (appunti, richieste «sistema»): se la macchina che lancia i test
// ha queste variabili, il server di prova inoltrava appunti finti di «Luisa» («Il microfono non parte») a chi segue l'app.
// Tolte qui, così non arrivano né al webServer né ai server avviati dai singoli test (ereditano process.env).
for (const k of Object.keys(process.env)) if (/^(NOTES|SISTEMA)_WEBHOOK_/.test(k)) delete process.env[k];

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8766',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'rm -rf /tmp/nova-e2e-empty && mkdir -p /tmp/nova-e2e-empty && NOVA_E2E=1 DATA_DIR=/tmp/nova-e2e-empty PORT=8766 node server.js',
    url: 'http://127.0.0.1:8766/',
    reuseExistingServer: false,
    timeout: 20000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
