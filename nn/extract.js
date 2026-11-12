'use strict';
// Estrae solo testo da documenti caricati: mai esegue i file.
const path = require('path');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const CAP = 200000;
const DOC_EXT = {
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf',
};
const DOC_MIME = new Set(Object.values(DOC_EXT));

function extOf(name, type) {
  const e = String(name || '').split('.').pop().toLowerCase();
  if (DOC_EXT[e]) return e;
  for (const [k, v] of Object.entries(DOC_EXT)) if (v === type) return k;
  return '';
}
function kindOf(name, type) {
  const e = extOf(name, type);
  return e ? 'file' : null;
}
function safeName(s) {
  s = String(s || 'documento').split(/[/\\]/).pop();
  s = s.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 80);
  return s || 'documento';
}
function stripXml(xml) {
  return String(xml || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}
function cap(s) { s = String(s || '').replace(/\u0000/g, '').trim(); return s.length > CAP ? s.slice(0, CAP) : s; }

async function fromZipXml(buf, pred) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(pred).sort();
  const parts = [];
  for (const n of names) {
    const xml = await zip.files[n].async('string');
    const t = stripXml(xml);
    if (t) parts.push(t);
  }
  return parts.join('\n');
}

async function extractPdf(buf) {
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(buf), disableWorker: true, isEvalSupported: false }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      text += c.items.map((x) => x.str).join(' ') + '\n';
    }
    return text;
  } catch (err) {
    // riserva: pdftotext di sistema, se presente
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync('pdftotext', ['-q', '-', '-'], { input: buf, encoding: 'utf8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
      if (r.status === 0 && r.stdout) return r.stdout;
    } catch {}
    throw err;
  }
}

async function extract(buf, name, type) {

  const e = extOf(name, type);
  if (!e || !Buffer.isBuffer(buf) || !buf.length) return { text: '', scanned: false, readable: false };
  try {
    if (e === 'txt' || e === 'md' || e === 'csv' || e === 'json') {
      let t = buf.toString('utf8');
      if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
      return { text: cap(t), scanned: false, readable: !!t.trim() };
    }
    if (e === 'pdf') {
      const t = cap(await extractPdf(buf));
      return { text: t, scanned: !t, readable: !!t };
    }
    if (e === 'docx') {
      const out = await mammoth.extractRawText({ buffer: buf });
      const t = cap(out && out.value);
      return { text: t, scanned: false, readable: !!t };
    }
    if (e === 'xlsx' || e === 'xls' || e === 'ods') {
      const wb = XLSX.read(buf, { type: 'buffer' });
      const parts = (wb.SheetNames || []).map((n) => {
        const sheet = wb.Sheets[n];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return csv && csv.trim() ? (n + ':\n' + csv) : '';
      }).filter(Boolean);
      const t = cap(parts.join('\n\n'));
      return { text: t, scanned: false, readable: !!t };
    }
    if (e === 'pptx') {
      const t = cap(await fromZipXml(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)));
      return { text: t, scanned: false, readable: !!t };
    }
    if (e === 'odt') {
      const t = cap(await fromZipXml(buf, (n) => n === 'content.xml'));
      return { text: t, scanned: false, readable: !!t };
    }
    if (e === 'rtf') {
      const raw = buf.toString('latin1');
      const t = cap(raw.replace(/\\'[0-9a-fA-F]{2}/g, ' ').replace(/\\[a-zA-Z]+-?\d* ?/g, ' ').replace(/[{}]/g, ' ').replace(/\s+/g, ' '));
      return { text: t, scanned: false, readable: !!t };
    }
  } catch (err) {
    console.error('Estrazione testo non riuscita:', e, err && err.message);
    return { text: '', scanned: e === 'pdf', readable: false };
  }
  return { text: '', scanned: false, readable: false };
}

module.exports = { DOC_EXT, DOC_MIME, extOf, kindOf, safeName, extract, CAP };
