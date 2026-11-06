# Nova — roadmap (snapshot WIP)

## Verificato sul branch `nova-8.6-stabilizzazione` (non pubblicato)

Solo ciò che i test di questo branch hanno eseguito. Il tag `stable-v8.6.6` resta il baseline su `main`.

- **UI una sola avatar, parte home.** Pubblicata su `main` (`87ed29c` più la cache `app-privata-v8-6-7` in `6ecc87b`). All’ingresso la schermata è la conversazione di Nova (`ready: greta`), non la lista e non Chiara. `#tab-chat` (lista, Nuovo, preset) non è visibile in `solo-mode`. Una seconda lettura dei personaggi non riapre la chat.
- **Dock e thread.** Il microfono del dock accende e spegne il dettato nel composer (`#chat-input`) e non chiama `App.call.start`. Home, anche tornando da Impostazioni, non richiama `chat.open` e non svuota `#messages`.
- **Voce in tempo reale nella chat.** Il tasto ⚡ del composer (`#solo-rt`) avvia e ferma la sessione; non è il microfono del dock e non entra in `in-call`. Il thread resta in `#messages`. L’invio in chat riceve lo stream di testo (xAI imitato). `npm run check` ok. Playwright Chromium e WebKit a 390×844: 8/8. Non verificato: WebSocket xAI vero, microfono fisico, labiale misurato, consenso vocale, iPhone.

## Cosa c’è in produzione (v8.5.2, live / in pubblicazione)

- **Luisa sbloccata**: può creare/modificare personaggi (3 campi, foto, voce, look), preparare movimenti, eliminare solo i personaggi che ha creato. Restano solo-admin: chiave API, Senza freni, attivazione adulti, gestione utenti. Gating adulti e consenso di entrambi invariati.
- **Matteo rimosso**: non più in seed; eliminato all’avvio solo se è ancora quello seedato; `assets/ready/matteo.jpg` tolto.
- **Jitter ridotto**: un solo motore di movimento (canvas); CSS solo in fallback `.av-stalled`; isteresi sul watchdog; punti del viso con dissolvenza. Misura 10 s @390×844: max spostamento centro viso **0,114 px**/frame, media **0,017**, nessun picco >2.
- Zip: `/workspace/app-privata-v8.5.2.zip`, cache SW `app-privata-v8-5-2`.

## Lavoro in corso (v8.6.0, non finito)

Obiettivo: **un’unica avatar donna (Greta)**, realismo massimo, movimenti quotidiani, dialogo veloce tipo Grok/ChatGPT.

### Già toccato in questo albero

| File | Cosa |
|------|------|
| `public/sw.js` | Cache impostata a `app-privata-v8-6-0` |
| `public/js/diag.js` | Etichetta v8.6.0 |
| `server.js` | `SOLO_KEY` / `SOLO_FIXED`, `getSoloChar`, chiave server (`getServerAiKey` / `setServerAiKey`), prompt stile Grok più ampio, personalità fissa Greta in `buildSystem`, campo `requests`, `NO_BRAKES` con adulti attivi, `tools: web_search` in sessione realtime, nuovi id movimento (`gesticola`, `tocco_viso`, `tocco_capelli`, `mangia`), `generateActionClip` + `prepSoloMotions`, rotte `/api/solo`, `/api/solo/prep`, `/api/server-key`, `/api/solo/requests` |
| `READY_CHARS` Greta | Punta a `SOLO_FIXED` (va ripulito il doppio `style`/`orders` legacy) |

### Manca ancora (piano di implementazione)

1. **UI una sola avatar** — La home (lista nascosta, apertura di Nova / id `greta`, niente fallback sul primo personaggio) è verificata sul branch, vedi sopra. Resta da fare e non è verificato: rimuovere/nascondere face-swap (`#faceswap-panel`, tab face in `live.js`/`media.js`) e ogni “copia movimenti”; nascondere lista azioni, `#act-prepare`, menu Prepara (Hot può restare solo se utile agli adulti già sbloccati, senza lista “da preparare”). I dati in archivio restano intatti.
2. **Aspetto modificabile a testo** — Nell’editor (o pannello compatto): campi semplici corpo / capelli (colore·lunghezza·stile) / occhi / vestiti → `POST` regenerate esistente o `/api/solo/look` che aggiorna `look`+`appearance` e rilancia prep movimenti. Personalità/carattere/ordini **non** editabili in UI (testo fisso `SOLO_FIXED`).
3. **Campo «Richieste» + toggle 18+** — Un textarea `requests` (salva con `/api/solo/requests`); accanto toggle adulti (solo admin, stesso gating e doppio consenso). Con adulti attivi per entrambi → sblocco massimo già previsto (`NO_BRAKES`).
4. **Movimenti server-side** — Completare e testare `prepSoloMotions` all’avvio (se c’è chiave env/file) e dopo cambio look; al primo login admin chiamare `/api/solo/prep` con `X-AI-Key` (opz. `store`). Adulti: stesse definizioni + gating; rifiuto xAI → skip silenzioso. Config interna movimenti in `ACTIONS` (Nicola chiederà nuovi in chat).
5. **Movimenti quotidiani + labiale** — Usare i nuovi id + esistenti (acqua, vino, patatine, capelli…). In chiamata: gesti contestuali con crossfade (già in `avatar.js`); labiale da audio reale (`speakLive` / `speakAudio` in `realtime.js`/`voice.js`) — verificare che non resti mai muta (`Lettura`/TTS sempre on in solo). Un solo driver di moto (tenere fix v8.5.2).
6. **2.5D / 3D** — In questo build: restare su 2.5D (foto + WebGL breath + clip). Piano concreto in report: fase A migliorare blend/framing; fase B Live2D/Ready Player Me o Gaussian avatar se Nicola vuole asset dedicati.
7. **Velocità e conoscenza** — Realtime default + prewarm (già); `web_search` in sessione voce (già in `rtSession`); valutare tools anche sul path chat/Responses API; niente apprendimento da fotocamera (`Motion.Style` / setStyle disattivati in solo).
8. **QA** — `npm run check`, screenshot 390×844, cattura 10 s con stats centro-viso, zip `/workspace/app-privata-v8.6.0.zip` senza `.env`/SETUP_CODE/`data`.

## Non pubblicare da questo snapshot

Questo zip è solo confronto / handoff. La pubblicazione resta al cloud agent / Nicola.
