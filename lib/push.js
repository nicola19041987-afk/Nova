/* Web Push for incoming calls ("Ira ti chiama").
   VAPID keys live only in env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).
   Never log, print, or put the private key in a response or commit. */
'use strict';

const fs = require('fs');
const path = require('path');

function loadWebPush() {
  try { return require('web-push'); } catch {}
  try { return require(path.join(__dirname, '..', '.deps', 'node_modules', 'web-push')); } catch {}
  return null;
}

function publicKey() {
  return String(process.env.VAPID_PUBLIC_KEY || '').trim();
}
function privateKey() {
  return String(process.env.VAPID_PRIVATE_KEY || '').trim();
}
function subject() {
  return String(process.env.VAPID_SUBJECT || 'mailto:ira@localhost').trim();
}

function enabled() {
  return !!(publicKey() && privateKey() && loadWebPush());
}

function config() {
  // Public key is meant for the browser; private is never included.
  return { enabled: enabled(), publicKey: publicKey() || '' };
}

function subsFile(dataDir, user) {
  return path.join(dataDir, 'users', String(user), 'push-subs.json');
}

function loadSubs(dataDir, user) {
  try {
    const raw = JSON.parse(fs.readFileSync(subsFile(dataDir, user), 'utf8'));
    return Array.isArray(raw) ? raw.filter((s) => s && s.endpoint) : [];
  } catch { return []; }
}

function saveSubs(dataDir, user, list) {
  const file = subsFile(dataDir, user);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file);
}

function validSub(body) {
  const endpoint = String((body && body.endpoint) || '').trim();
  const keys = (body && body.keys) || {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/127\.0\.0\.1/i.test(endpoint) && !/^http:\/\/localhost/i.test(endpoint)) return null;
  if (endpoint.length > 2048 || p256dh.length < 16 || auth.length < 8) return null;
  return { endpoint, keys: { p256dh, auth } };
}

function subscribe(dataDir, user, body) {
  const sub = validSub(body);
  if (!sub) return { ok: false, error: 'Iscrizione non valida' };
  const list = loadSubs(dataDir, user).filter((s) => s.endpoint !== sub.endpoint);
  list.push(sub);
  saveSubs(dataDir, user, list.slice(-12));
  return { ok: true, count: list.length };
}

function unsubscribe(dataDir, user, body) {
  const endpoint = String((body && body.endpoint) || '').trim();
  const list = loadSubs(dataDir, user).filter((s) => s.endpoint !== endpoint);
  saveSubs(dataDir, user, list);
  return { ok: true, count: list.length };
}

async function sendToUser(dataDir, user, payload) {
  if (!enabled()) return { ok: false, delivered: 0, reason: 'push-disabilitato' };
  const webPush = loadWebPush();
  // setVapidDetails once per send; values stay in memory, not in logs.
  try { webPush.setVapidDetails(subject(), publicKey(), privateKey()); } catch (e) {
    return { ok: false, delivered: 0, reason: 'vapid-non-valido' };
  }
  const body = JSON.stringify(payload || {});
  const list = loadSubs(dataDir, user);
  let delivered = 0;
  const keep = [];
  for (const sub of list) {
    try {
      await webPush.sendNotification(sub, body, { TTL: 60, urgency: 'high', headers: { Urgency: 'high' } });
      delivered += 1;
      keep.push(sub);
    } catch (e) {
      const status = e && (e.statusCode || e.status);
      if (status === 404 || status === 410) continue; // subscription gone
      keep.push(sub);
    }
  }
  if (keep.length !== list.length) saveSubs(dataDir, user, keep);
  return { ok: true, delivered, attempted: list.length };
}

module.exports = { config, enabled, publicKey, subscribe, unsubscribe, sendToUser, validSub };
