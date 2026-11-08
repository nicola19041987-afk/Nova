/* docs.js — "documenti per gioco" dell'avatar, generati su canvas.
 * Design INVENTATO: non riproduce layout, stemmi o elementi di sicurezza di documenti reali.
 * Dati di fantasia e filigrana "FAC-SIMILE – NON VALIDO" ben visibile su ogni documento. */
(function () {
  const W = 900, H = 560;
  const rnd = (n, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const loadImg = (src) => new Promise((res) => { if (!src || !(src.startsWith('/api/') || src.startsWith('data:'))) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function photo(ctx, img, emoji, x, y, w, h) {
    ctx.save(); rounded(ctx, x, y, w, h, 18); ctx.clip(); ctx.fillStyle = '#efe3f3'; ctx.fillRect(x, y, w, h);
    if (img) { const s = Math.min(img.naturalWidth, img.naturalHeight); ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2 * 0.6, s, s * h / w, x, y, w, h); }
    else { ctx.font = `${w * 0.6}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(emoji || '💫', x + w / 2, y + h / 2); }
    ctx.restore(); ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 4; rounded(ctx, x, y, w, h, 18); ctx.stroke();
  }
  function fields(ctx, list, x, y, color = '#3b1a40') {
    list.forEach(([k, v], i) => {
      ctx.fillStyle = '#8a5a8f'; ctx.font = '600 17px system-ui'; ctx.textAlign = 'left'; ctx.fillText(k.toUpperCase(), x, y + i * 56);
      ctx.fillStyle = color; ctx.font = '600 27px Georgia, serif'; ctx.fillText(v, x, y + i * 56 + 28);
    });
  }
  function watermark(ctx, w, h) {
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.38);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(210,20,40,0.13)'; ctx.font = '800 30px system-ui';
    for (let yy = -h; yy <= h; yy += 70) for (let xx = -w; xx <= w; xx += 420) ctx.fillText('FAC-SIMILE – NON VALIDO', xx + (yy / 70 % 2 ? 210 : 0), yy);
    ctx.fillStyle = 'rgba(210,20,40,0.55)'; ctx.font = '900 64px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.strokeText('FAC-SIMILE – NON VALIDO', 0, 0); ctx.fillText('FAC-SIMILE – NON VALIDO', 0, 0);
    ctx.restore();
  }
  function card(ctx, x, y, w, h, c1, c2) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; rounded(ctx, x, y, w, h, 28); ctx.fill();
    // motivo decorativo inventato: cuori e onde
    ctx.save(); rounded(ctx, x, y, w, h, 28); ctx.clip(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#fff';
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(x + (i * 97) % w, y + (i * 53) % h, 30 + (i % 4) * 14, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  const birth = (age) => `14/02/${new Date().getFullYear() - Math.max(25, age || 30)}`;

  async function draw(type, ch) {
    const c = $('#doc-canvas'), ctx = c.getContext('2d'); ctx.clearRect(0, 0, W, H);
    const img = await loadImg(ch.avatar); const a = ch.appearance || {};
    if (type === 'id') {
      card(ctx, 10, 10, W - 20, H - 20, '#f9d8e8', '#c9b6f2');
      ctx.fillStyle = '#5b1f63'; ctx.font = '800 34px Georgia, serif'; ctx.textAlign = 'left'; ctx.fillText('Documento di Fantasia', 50, 72);
      ctx.font = 'italic 20px Georgia, serif'; ctx.fillText('Principato Immaginario dei Sogni Condivisi · carta del cuore', 50, 102);
      photo(ctx, img, ch.avatar, 50, 140, 250, 310);
      fields(ctx, [['Nome', ch.name || 'Senza nome'], ['Cognome', 'Di Fantasia'], ['Nata il', `${birth(a.age)} · Isola che non c'è`], ['Statura', `${a.height || 168} cm · sguardo magnetico`], ['Professione', 'Complice a tempo pieno']], 340, 160);
      ctx.fillStyle = '#5b1f63'; ctx.font = '600 18px monospace'; ctx.fillText(`N. FANTA-${rnd(6)} · scade: mai`, 50, 500);
    } else if (type === 'health') {
      card(ctx, 10, 10, W - 20, H - 20, '#c8f0e6', '#9ec9f5');
      ctx.fillStyle = '#0f4a5a'; ctx.font = '800 34px Georgia, serif'; ctx.textAlign = 'left'; ctx.fillText('Tessera del Benessere di Coppia', 50, 72);
      ctx.font = 'italic 20px Georgia, serif'; ctx.fillText('Cassa Mutua delle Coccole — documento inventato', 50, 102);
      photo(ctx, img, ch.avatar, W - 260, 140, 200, 240);
      fields(ctx, [['Titolare', ch.name || 'Senza nome'], ['Codice coccole', `${rnd(4)}-${rnd(4)}-${rnd(4)}`], ['Copertura', 'Abbracci illimitati, baci senza ticket'], ['Medico curante', 'Dott.ssa Tenerezza'], ['Validità', 'Finché dura l\'amore']], 50, 160, '#0f3a48');
    } else {
      // portafoglio: superficie "pelle" inventata con mini-tessere e un buono scherzoso
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#6b3b2a'); g.addColorStop(1, '#3d2018');
      ctx.fillStyle = g; rounded(ctx, 10, 10, W - 20, H - 20, 30); ctx.fill();
      ctx.setLineDash([10, 8]); ctx.strokeStyle = '#d9a46a'; ctx.lineWidth = 3; rounded(ctx, 30, 30, W - 60, H - 60, 24); ctx.stroke(); ctx.setLineDash([]);
      card(ctx, 60, 70, 360, 220, '#f9d8e8', '#c9b6f2'); photo(ctx, img, ch.avatar, 80, 95, 120, 150);
      ctx.fillStyle = '#5b1f63'; ctx.font = '700 22px Georgia, serif'; ctx.textAlign = 'left'; ctx.fillText(ch.name || 'Senza nome', 220, 130); ctx.font = '16px system-ui'; ctx.fillText('Carta del cuore (finta)', 220, 158);
      card(ctx, 470, 70, 360, 220, '#c8f0e6', '#9ec9f5'); ctx.fillStyle = '#0f4a5a'; ctx.font = '700 22px Georgia, serif'; ctx.fillText('Benessere di Coppia', 495, 130); ctx.font = '16px system-ui'; ctx.fillText(`Codice ${rnd(4)}-${rnd(4)}`, 495, 160);
      ctx.fillStyle = '#e9f5d9'; rounded(ctx, 60, 320, 770, 170, 16); ctx.fill();
      ctx.fillStyle = '#2f5a1e'; ctx.font = '800 40px Georgia, serif'; ctx.fillText('BUONO DA 100 BACI', 100, 395);
      ctx.font = 'italic 20px Georgia, serif'; ctx.fillText(`Emesso dalla Banca dei Sogni a favore di ${ch.name || 'te'} · non è denaro`, 100, 435);
      ctx.fillStyle = '#d9a46a'; ctx.font = '600 16px system-ui'; ctx.fillText('Scontrino: 1 cena romantica · 2 cocktail · 1 promessa', 60, 525);
    }
    watermark(ctx, W, H);
    c.hidden = false; $('#doc-actions').hidden = !App.canExport();
    c.dataset.name = `${(ch.name || 'avatar').replace(/\W+/g, '_')}-${type}-FAC-SIMILE.png`;
  }
  App.docs = { render: draw };
  $('#doc-download').addEventListener('click', () => {
    if (!App.canExport()) return App.toast('Esportazione disattivata');
    const c = $('#doc-canvas'); const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = c.dataset.name; a.click();
  });
  $('#doc-share').addEventListener('click', () => { const c = $('#doc-canvas'); App.share(c.toDataURL('image/png'), c.dataset.name, 'Documento per gioco — FAC-SIMILE, NON VALIDO'); });
})();
