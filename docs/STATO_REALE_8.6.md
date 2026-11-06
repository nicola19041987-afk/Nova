# Stato reale — 8.6.6 (baseline `stable-v8.6.6`)

Riferimento ripristinabile: tag `stable-v8.6.6` sul commit `bde54667b2a3c643d8b5b4b13096a4244439f996`. `main` pubblicato dopo l’autorizzazione di Nicola: sopra `f2d3fb8` c’è il labiale `cfa1908`, cache service worker `app-privata-v8-6-9`. `ROADMAP_IT.md` e `ARCHITETTURA_IT.md` descrivono ancora, più sotto, lo snapshot v8.6.0.

Branch di lavoro: `nova-8.6-stabilizzazione`.

## Cosa funziona (verificato sul codice e, dove indicato, in browser)

- Login PIN e schermata nera con wordmark Nova. Il blocco di `close.js` (MutationObserver che riscriveva `hidden` a ogni mutazione e congelava il login prima di `DOMContentLoaded`) è corretto da v8.6.5.1: scrittura solo se cambia, osservatore staccato durante la scrittura, richieste accorpate con `requestAnimationFrame`. `stage.js` ha un osservatore diverso, che non scrive `hidden` nel callback.
- Un solo personaggio di prodotto: id interno `greta`, file `assets/ready/greta.jpg`, nome visibile Nova (`SOLO_KEY`, migrazione del solo nome seedato).
- Dopo l’accesso la shell aggiunge `body.solo-mode`, apre la conversazione e mostra palco, chat, composer e dock (Home, Microfono, Camera, Impostazioni). Su viewport >500px la colonna è centrata, max 430px, sfondo nero.
- Chat condivisa con polling, note di assistenza, foglio umore. La foto in alto a sinistra elenca gli avatar non di sistema: creati da Nicola, senza autore (come Luna, se è ancora sul disco), o con messaggi di Nicola, ordinati per numero di messaggi. Attiva / Cancella. Cache `app-privata-v8-6-15`. Il foglio include anche gli avatar di Luisa e quelli con video, non gli uomini.
- `npm run check` è l’unico controllo automatico storico: sintassi di server, script e JS pubblici.

## Corretto su questo branch (priorità 1)

La home non era bloccata su Nova. Cause, insieme: `soloChar()` / `getSoloChar()` prendevano il primo personaggio se `greta` mancava; il CSS non nascondeva `#tab-chat`; `display:flex!important` su `#tab-conv` batteva `[hidden]`; dopo il boot `data-tab` tornava `chat`; ogni `loadChars` rilanciava `boot()` e riapriva la chat; `setDock` chiamava `$$`, che esiste solo in `core.js`, e il `ReferenceError` chiudeva il boot. Il branch tiene solo Nova (`ready === 'greta'` o nome Nova/Greta), nasconde la lista, lascia chiudere la conversazione quando serve, non riapre la chat alle letture successive e segna il dock senza `$$`. Verifica: `npm run check`; Playwright Chromium e WebKit a 390×844 (login reale; home Nova con Chiara presente nella lista mock).

## Corretto su questo branch (priorità 2)

Il microfono del dock chiamava `App.call.start('voice')` e Home richiamava `chat.open`. Ora il dock detta nel composer e Home non svuota il thread. La voce in tempo reale partiva solo dalla chiamata, che in solo nasconde avatar e barra e, se cade, passa alla chiamata classica. Il tasto ⚡ nel composer (`#solo-rt`) avvia e ferma `App.rt` senza `in-call`. Se il collegamento cade fuori da una chiamata, la sessione si chiude e il microfono si rilascia; la chat resta. L’invio di un messaggio usa `POST /api/chats/:id` e mostra la risposta nel thread. Verifica: `npm run check`; Playwright Chromium e WebKit a 390×844, 8/8, con WebSocket, microfono e stream xAI imitati. Non eseguiti: WebSocket xAI vero, microfono del dispositivo, labiale misurato, iPhone.

## Incompleto o rotto

1. **Voce realtime, labiale e movimenti** dipendono da chiave xAI, clip già preparate e da un solo motore canvas. Il jitter è stato misurato in v8.5.2, non rifatto su 8.6.6. Preparazione movimenti (`/api/solo/prep`) parte in background e non è coperta da test. La Camera del dock apre ancora la videochiamata.
2. **Aspetto, iPhone, logout inatteso** non sono stati rieseguiti sull’app autenticata in questa fase. Le schermate 390×844 / 430×932 / 1280×800 della 8.6.6 erano HTML statico o Chrome headless sulla login, non un giro completo dopo il PIN. Il consenso vocale e l’invio di un messaggio vero non sono stati eseguiti: il test della home usa le API imitate, il test del login usa il server vuoto e si ferma alla scelta del profilo.

## Conflitti e codice duplicato

- Due selettori CSS descrivono `#tab-conv` in solo. Ora entrambi rispettano `[hidden]`; restano comunque duplicati.
- Nome visivo: roadmap e commenti dicono ancora Greta; UI, `SOLO_FIXED` e titolo dicono Nova. L’id resta `greta`.
- `chat.close()` in solo non torna alla lista. Il dock Home non richiama più `chat.open` se Nova è già aperta. La lista resta nel DOM, nascosta dal CSS.
- `ARCHITETTURA_IT.md` parla di tema WhatsApp scuro; il tema in uso è grigio chiaro `#ECEFF3` e blu `#1E6FD9`.

## Dipendenze tra i pezzi

Login (`auth.js`) → `App.boot` → `loadChars` (wrapper solo) → `solo.boot` → `chat.open` → palco `TalkingAvatar` (`avatar.js` / `fitFrame` in `main.js`). Il dock Microfono passa da `voice.js` (dettato nel composer). Il tasto ⚡ avvia `App.rt`: il PCM alimenta il labiale in `avatar.js` e i messaggi restano in chat. La Camera passa ancora da `call.js`. I movimenti stanno in `actions.js` + clip server (`prepSoloMotions`). L’aspetto testuale è il dialogo in `solo.js` che chiama `POST /api/characters/:id/regenerate`. Il service worker tiene la shell: un fix client non arriva finché la cache non cambia.

## Priorità 8.6 (bloccanti, in quest’ordine)

1. **UI principale con l’unica avatar (Nova, id `greta`).** La home è verificata sul branch (vedi sopra). Restano fuori da questa verifica face-swap, lista azioni e menu Prepara.
2. **Chat stabile + voce realtime.** Dettato del dock, thread di Home, sessione realtime dal tasto ⚡ e invio in chat con risposta imitata sono verificati. Restano il collegamento xAI vero e il microfono del dispositivo.
3. **Sync voce / labbra / movimento.** Sulla sessione ⚡ la bocca segue l’inviluppo del PCM, è centrata sulla mezzeria degli occhi e il movimento senza clip resta nel canvas, sopra la chat. Misurato su Chromium e WebKit a 390×844 (correlazione, differenza di fotogramma, simmetria, jitter). Il controllo che schedula un buffer PCM è saltato su WebKit: il renderer si chiude. iPhone fisico non provato.
4. **Movimento naturale senza jitter né sovrapposizioni.** Misura vecchia (v8.5.2). Clip e CSS di fallback convivono.
5. **Personalizzazione aspetto.** Il dialogo «Aspetto di Nova» c’è; non è verificato end-to-end (serve chiave xAI).
6. **Preparazione e gestione movimenti stabile.** `/api/solo/prep` esiste; la UI di prep è ancora nel codice storico.
7. **Compatibilità mobile.** Viewport e colonna ci sono. Playwright WebKit a 390×844 copre solo login e home Nova in questo branch. Safari iOS su dispositivo e i movimenti procedurali non sono stati rieseguiti.

## Backlog (richieste precedenti, non da implementare ora)

| Richiesta | Priorità a cui appartiene |
|-----------|---------------------------|
| Il microfono del dock non avvia più una chiamata (dettato nel composer, verificato). Togliere la UI della chiamata vocale | 2 |
| Chat stabile, ultimo messaggio non sotto il dock, tastiera | 2 |
| «zittisci» e microfono piccolo | 2, 3 |
| Videochiamata, gesti come comandi, «impara questo gesto» (MediaPipe), fullscreen automatico sulle azioni a figura intera | 3, 4, 6 — fuori dalla sequenza finché 1–3 non sono stabili |
| Aspetto avatar | 5 |
| Movimenti procedurali su iOS Safari, gestione clip | 4, 6, 7 |
| Appunto iPhone (tastiera), logout inatteso, X su ogni schermata | tenuta di 1 e 7; il logout tocca la sessione e non si modifica senza una causa verificata |
| Nota:/Appunto: in chat inoltrate al webhook | accanto alle note di assistenza già presenti; non è una delle sette priorità |
| Playwright su ogni controllo del dock, impostazioni e X | rete di sicurezza da estendere dopo il test della home |

## Cosa non è stato toccato

Auth, PIN, utenti, permessi, privacy, consensi adulti. Nessun `.env`, `SETUP_CODE*` o `data/` nel commit.
