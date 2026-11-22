/* v2d-66: memoria dei gesti — solo conteggi d'uso dei clip 2D del catalogo luogo. Non crescono i file media. */
(function () {
  const counts = Object.create(null);
  function playCount(url) {
    const e = counts[url];
    return (e && Number(e.playCount)) || 0;
  }
  function weight(clip) {
    const base = Math.max(0.05, Number(clip && clip.weight) || 1);
    const n = playCount(clip && clip.url);
    return base * (1 + Math.log1p(n));
  }
  App.motionMemory = {
    playCount,
    weight,
    apply(lib) {
      return (lib || []).map((c) => ({ ...c, weight: weight(c) }));
    },
    async load() {
      try {
        const r = await App.api('/api/motion-memory');
        const clips = (r && r.clips) || {};
        for (const k of Object.keys(counts)) delete counts[k];
        for (const [url, e] of Object.entries(clips)) counts[url] = e;
      } catch { /* offline: si resta sui conteggi già in memoria */ }
    },
    record(clip) {
      const url = clip && clip.url;
      if (!url || !/^\/api\/locations\/[a-z0-9_-]+\//.test(url)) return;
      const e = counts[url] ? { ...counts[url] } : { playCount: 0 };
      e.playCount = (Number(e.playCount) || 0) + 1;
      e.lastPlayedAt = new Date().toISOString();
      counts[url] = e;
      if (App.api) App.api('/api/motion-memory/play', { method: 'POST', body: { url } }).catch(() => {});
    },
  };
})();
