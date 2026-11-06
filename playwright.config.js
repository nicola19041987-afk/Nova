const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:8766',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'rm -rf /tmp/nova-e2e-empty && mkdir -p /tmp/nova-e2e-empty && DATA_DIR=/tmp/nova-e2e-empty PORT=8766 node server.js',
    url: 'http://127.0.0.1:8766/',
    reuseExistingServer: false,
    timeout: 20000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
