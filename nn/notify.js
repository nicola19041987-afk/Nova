'use strict';
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

function createNotify(DATA_DIR) {
  const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
  const SUBS_FILE = path.join(DATA_DIR, 'push-subs.json');
  let vapid = null;
  let subs = {};

  function loadVapid() {
    if (vapid) return vapid;
    try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); }
    catch {
      vapid = webpush.generateVAPIDKeys();
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid), { mode: 0o600 });
      try { fs.chmodSync(VAPID_FILE, 0o600); } catch {}
    }
    webpush.setVapidDetails('mailto:luisa-nico@localhost', vapid.publicKey, vapid.privateKey);
    return vapid;
  }
  function publicKey() { return loadVapid().publicKey; }
  function loadSubs() {
    try { subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')) || {}; } catch { subs = {}; }
  }
  function saveSubs() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SUBS_FILE + '.tmp', JSON.stringify(subs));
    fs.renameSync(SUBS_FILE + '.tmp', SUBS_FILE);
  }
  function subscribe(role, sub) {
    if (!role || !sub || !sub.endpoint) return false;
    loadSubs();
    const list = subs[role] || [];
    const i = list.findIndex((s) => s.endpoint === sub.endpoint);
    if (i >= 0) list[i] = sub; else list.push(sub);
    subs[role] = list;
    saveSubs();
    return true;
  }
  function unsubscribe(role, endpoint) {
    loadSubs();
    if (!endpoint) { delete subs[role]; }
    else subs[role] = (subs[role] || []).filter((s) => s.endpoint !== endpoint);
    saveSubs();
  }
  function has(role) { loadSubs(); return !!(subs[role] && subs[role].length); }
  async function send(role, payload) {
    loadVapid(); loadSubs();
    const list = (subs[role] || []).slice();
    if (!list.length) return 0;
    const body = JSON.stringify(payload);
    let n = 0;
    for (const s of list) {
      try { await webpush.sendNotification(s, body, { TTL: 90, urgency: 'high' }); n++; }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(role, s.endpoint);
        else console.error('Push non inviata:', e.statusCode || e.message);
      }
    }
    return n;
  }
  loadVapid(); loadSubs();
  return { publicKey, subscribe, unsubscribe, send, has };
}

module.exports = { createNotify };
