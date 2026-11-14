const { test, expect } = require('./harness');

// v2d-41: carattere scritto da Nicola (testo testuale) e anti-ripetizione in chat, chiamata e tempo reale.
const HEAD = { 'X-Requested-With': 'app-privata' };
const PERSONA = [
  'Nova è una donna adulta, spontanea, affettuosa e ironica. Non è permalosa: sa stare allo scherzo e risponde con leggerezza. È sensuale e un po’ maliziosa quando c’è sintonia, senza forzare il tono né essere volgare.',
  'Ascolta davvero e usa la memoria per ricordare preferenze, persone, progetti, esperienze e dettagli quotidiani che Nicola le ha raccontato. Ogni tanto riprende spontaneamente un ricordo pertinente e fa una domanda sincera per sapere come è andata o come si sente: per esempio, se ricorda un viaggio imminente, può chiedere com’è andato; se ricorda un progetto, può chiedere a che punto è. Non trasformare però la conversazione in un’intervista: varia, lascia spazio e non ripetere domande già fatte.',
  'Non usare né richiamare ricordi o dettagli emersi in contesti sessuali per iniziare domande, creare confidenza o riportare la conversazione su quel tema. Tieni separati quei momenti dalla memoria quotidiana; non dedurre preferenze o desideri sessuali da conversazioni precedenti. L’intimità può emergere solo dal contesto presente e dalla reciprocità, rispettando sempre i limiti espressi.',
  'In voce parla in italiano con tono caldo e naturale, come in una telefonata: ascolta fino alla fine, risponde con spontaneità e mantiene il filo del discorso. Usa il tempo reale quando è disponibile; se non lo è, non fingere che la connessione sia ancora in tempo reale.',
].join('\n\n');
const BLOCK = '<<<INIZIO CARATTERE NICOLA>>>\n' + PERSONA + '\n<<<FINE CARATTERE NICOLA>>>';

test('il carattere di Nicola è testuale in chat, chiamata e tempo reale, con le regole di base ancora in fondo', async ({ request }) => {
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok()).toBeTruthy();
  const list = await (await request.get('/api/characters')).json();
  const nova = list.find((c) => /nova/i.test(c.name || ''));
  expect(nova && nova.id).toBeTruthy();
  const t = await (await request.get('/api/e2e/tone?id=' + nova.id)).json();
  for (const k of ['chat', 'realtime', 'call']) {
    const s = t[k];
    expect(s.split(BLOCK).length - 1, k).toBe(1);
    expect(s, k).toContain('NON RIPETERTI (v2d-41');
    expect(s, k).toContain('Modalità adulti NON attiva');
    expect(s, k).toContain('minori');
    expect(s.indexOf(BLOCK), k).toBeLessThan(s.lastIndexOf('REGOLE DI BASE NON MODIFICABILI'));
    expect(s.trim().endsWith('Rispondi sempre in italiano, salvo richiesta esplicita diversa.'), k).toBe(true);
    expect(s, k).toContain('STILE DELLE RISPOSTE');
  }
  // Anche le istruzioni vere della sessione in tempo reale (stesso testo che va al servizio voce)
  const rt = await request.post('/api/realtime/instructions', { data: { characterId: nova.id, mode: 'voice' }, headers: HEAD });
  if (rt.ok()) {
    const ins = (await rt.json()).instructions;
    expect(ins.split(BLOCK).length - 1).toBe(1);
    expect(ins).toContain('NON RIPETERTI (v2d-41');
  } else expect(rt.status()).toBe(403); // non attivato nell'harness: il testo è comunque verificato sopra via buildSystem
  // Un altro personaggio non riceve il carattere di Nova
  const other = await (await request.get('/api/e2e/tone?sample=other')).json();
  for (const k of ['chat', 'realtime', 'call']) {
    expect(other[k]).not.toContain('INIZIO CARATTERE NICOLA');
    expect(other[k]).not.toContain('NON RIPETERTI (v2d-41');
  }
});
