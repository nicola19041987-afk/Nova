# App Privata 💜

Web app privata (PWA) per **Nico e Luisa**: chat con personaggi IA che evolvono, avatar animati e parlanti,
immagini e video con l'API **xAI** (estensione del tuo account Grok), Diario di coppia. Tutto in italiano.

## Requisiti
- Node.js 18 o superiore (testato con Node 24)
- Una chiave API xAI (console.x.ai) — si inserisce **nell'app**, non sul server
- Per usarla dal telefono: un indirizzo **HTTPS** (obbligatorio per fotocamera, microfono e installazione PWA)

## Installazione e avvio in locale
```bash
cd app-privata
npm install          # installa le dipendenze e prepara i file locali di MediaPipe (public/vendor)
cp .env.example .env # poi, se vuoi, imposta SETUP_CODE (consigliato se la pubblichi online)
npm start            # http://localhost:3000
```
Controllo sintassi di tutti i file: `npm run check`.

## Primo accesso (PIN)
1. Apri l'app e scegli il profilo **Nico** o **Luisa**.
2. La prima volta scegli il tuo **PIN a 4 cifre** (salvato sul server solo come hash bcrypt in `data/pins.json`).
   Se in `.env` c'è `SETUP_CODE`, viene chiesto anche quel codice. Una volta impostato, il PIN **non** si può reimpostare dalla schermata di accesso.
3. Dalle volte successive basta il PIN. Dopo 5 PIN sbagliati il profilo si blocca (5 min, poi 10, 20… fino a 24 h); c'è anche un limite di tentativi per dispositivo.
4. PIN dimenticato? Sul server: `npm run reset-pin -- nico` (o `luisa`), poi riavvia.

## Attivazione con consenso vocale (una sola volta)
Al primo ingresso ogni profilo registra il **consenso vocale** leggendo la frase proposta. L'audio viene salvato sul server
con data e ora ed è riascoltabile in *Account → Storico account*. Finché non c'è, chat e generazioni sono bloccate (anche lato server: errore 403).
Il consenso attiva anche la modalità adulti dell'account. Le **regole di base** restano sempre attive e non modificabili:
niente minori, niente atti non consensuali, niente atti illegali, niente contenuti sessuali con persone reali diverse da Nico e Luisa.

## Chiave xAI
*Account → Chiave API xAI*: incolla la chiave (campo nascosto, 👁️ per mostrarla). Resta **solo sul telefono** (localStorage);
a ogni richiesta il server la inoltra ad api.x.ai senza salvarla né scriverla nei log. Su ogni telefono va inserita una volta.

## Pubblicarla online con HTTPS
Scegli una strada:
- **Render / Railway**: crea un servizio Node dal progetto, comando di avvio `npm start`, variabili da `.env.example`
  (`COOKIE_SECURE=true`, `SETUP_CODE=...`). Aggiungi un **disco persistente** montato su `data/` (altrimenti i dati si perdono ad ogni riavvio).
- **VPS o computer di casa + tunnel**: `npm start` e poi un tunnel HTTPS, ad es. Cloudflare Tunnel
  (`cloudflared tunnel --url http://localhost:3000`). Il "quick tunnel" dà un indirizzo temporaneo che cambia a ogni riavvio;
  per un indirizzo fisso serve un tunnel con nome su un tuo dominio.
Online imposta sempre `COOKIE_SECURE=true` e un `SETUP_CODE`.

## Pubblicazione su Render
Sul piano **Starter**:
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Variabili d'ambiente**: `COOKIE_SECURE=true` e `SETUP_CODE` (segreto scelto dal proprietario; non va nel repository)
- **Disco persistente** montato su `/opt/render/project/src/data` (i file in `data/` restano tra un riavvio e l'altro)

## Installarla sul telefono
- **iPhone (Safari)**: apri l'indirizzo HTTPS → **Condividi** → **Aggiungi alla schermata Home**.
- **Android (Chrome)**: apri l'indirizzo → menu ⋮ → **Installa app** (o "Aggiungi a schermata Home").

## Cosa fa
- **Chat** con personaggi personalizzabili (nome, personalità, stile), cronologia sul server, risposte in streaming.
- **Personalità in evoluzione**: umore, stato della relazione, tratti e rancori aggiornati dopo le conversazioni; può discutere, offendersi, tenere il broncio.
- **Le mie regole**: regole/gioco personali applicate a ogni conversazione. **Memoria**: l'app impara gusti e preferenze (automatico o 📌 "Ricorda questo"); visibile, modificabile e cancellabile in Account.
- **Voce**: dettatura continua in italiano (si riavvia da sola finché il microfono è acceso), invio automatico o revisione, lettura delle risposte con voce italiana.
- **Avatar animato** (canvas): respiro, oscillazione, battito di ciglia, labiale sincronizzato alla voce, gesti delle braccia nelle inquadrature a mezzo busto/figura intera. Occhi e bocca si segnano trascinando i segni sull'immagine.
- **Aspetto**: genere, età (minimo 25), corporatura, forme, proporzioni, altezza, inquadratura (rigenerazione via xAI); colori istantanei. **Parrucchiere** (taglio, lunghezza, colore, piega, proposte rapide), **Guardaroba** (outfit rapidi, look salvati), **Identità base** (descrizione fissa + immagine di riferimento usata con l'endpoint di modifica immagini di xAI), **Cambi automatici** giornalieri leggeri, **Storico look** con ripristino.
- **Immagini e video** via xAI, **scambio volto/reinquadratura** via modifica immagini xAI, **ritaglio locale**.
- **Presenza**: fotocamera dal vivo (anteriore/posteriore) con l'avatar animato sovrapposto nella stanza. **Volto dal vivo**: sovrapposizione approssimata di un volto (solo Nico, Luisa o volti IA, con dichiarazione obbligatoria) calcolata sul telefono con MediaPipe Face Landmarker (file inclusi in `public/vendor`, nessun invio).
- **Documenti per gioco** (carta d'identità, tessera sanitaria, portafoglio) inventati, con filigrana "FAC-SIMILE – NON VALIDO".
- **Diario**: bacheca privata di coppia con didascalie scritte dal personaggio, mi piace e commenti solo tra voi due.
- **Privacy**: di default i contenuti generati restano solo in memoria finché non premi 💾; esportazione/condivisione disattivata (quando la attivi: solo "Scarica" e il menu di condivisione del telefono, manuali). Fotocamera e microfono spenti di default.
- **Cancella tutto** (Account): cancella con conferma, parola CANCELLA e PIN tutti i dati di entrambi i profili sul server e i dati locali del telefono, poi ti disconnette. I PIN restano, salvo la casella "Cancella anche i PIN".

## Come modificare
| Cosa | Dove |
|---|---|
| Regole di sicurezza fisse, prompt di sistema | `server.js` → `BASE_RULE`, `IMAGE_RULE`, `buildSystem()`, `stateText()` |
| Modelli e provider (compatibile OpenAI) | `.env` → `AI_BASE_URL`, `CHAT_MODEL`, `IMAGE_MODEL`, `IMAGE_EDIT_MODEL`, `VIDEO_*` |
| Opzioni di aspetto, parrucchiere, outfit, traduzioni nel prompt | `server.js` → `OPT`, `EN`, `buildImagePrompt()` |
| Filtro parole che suggeriscono minore età | `server.js` → `YOUTH_RE` |
| Variazioni automatiche del look | `server.js` → `subtleVariation()` |
| Proposte rapide del parrucchiere | `public/js/editor.js` → `HAIR_PRESETS` |
| Avatar animato (labiale, ciglia, gesti) | `public/avatar.js` |
| Documenti per gioco | `public/js/docs.js` |
| Fotocamera, Presenza, volto dal vivo | `public/js/live.js` |
| Voce (dettatura e lettura) | `public/js/voice.js` |
| Grafica | `public/style.css`; icone: `npm run icons` (`scripts/make-icons.js`) |
| Frase del consenso vocale | `server.js` → `CONSENT_PHRASE` |
Il server è un solo file diviso in sezioni commentate (`// ---------- ... ----------`); il frontend è HTML/CSS/JS semplice, senza build.
Dopo modifiche al frontend aumenta il numero di versione `CACHE` in `public/sw.js`.

## Dati
Tutto in `data/` sul server (escluso da git e dallo zip): `pins.json`, `sessions.json`, `users/<profilo>/…` (chat, personaggi, memoria, regole,
impostazioni, consenso audio, immagini, avatar, video), `shared/` (Diario). Fai un backup di questa cartella.

## Estensione facoltativa NON inclusa: scambio volto di alta qualità
Uno scambio volto realistico in tempo reale (InsightFace / ReActor) non gira nel browser di un telefono. Si potrebbe aggiungere
un piccolo servizio separato su una macchina con GPU (Python + InsightFace `inswapper`) che riceve due immagini e restituisce il risultato,
chiamato da `server.js` al posto di `/images/edits` in `/api/faceswap`, mantenendo gli stessi controlli (dichiarazione obbligatoria, solo Nico/Luisa o volti IA).
Non è installato né configurato.

## Limiti onesti (approssimato / non testato)
- **Non testato con la vera API xAI** (nessuna chiave usata): chat, memoria automatica, evoluzione della personalità, immagini, modifiche immagine, video e didascalie sono scritti secondo la documentazione xAI ma non provati end-to-end. Il formato multi-immagine di `/images/edits` (campo `images`) e `response_format` sono ipotesi ragionevoli.
- **Labiale** approssimato (eventi `boundary` + stima delle sillabe); su iOS gli eventi spesso mancano e si usa una simulazione a tempo. L'analisi audio reale (AnalyserNode) è pronta ma usata solo se si riproduce un audio.
- **Gesti** approssimati: le zone delle braccia ruotano attorno alle spalle in base al ritmo della voce. "Impara i gesti con la fotocamera" non è disponibile (nessuna libreria locale di tracciamento mani inclusa).
- **Volto dal vivo**: sovrapposizione 2D (trasformazione su 3 punti + maschera ovale sfumata), non un vero face swap; non testato su iPhone/Android reali (provato solo in Chrome desktop con fotocamera finta). Su iPhone, in modalità app dalla Home, la fotocamera può comportarsi in modo diverso: se non parte, aprila da Safari.
- **Riconoscimento vocale**: su Chrome usa il servizio online del produttore del browser (non funziona offline); su iOS/Safari il supporto è parziale.
- **Identità stabile**: dipende dal modello; con immagine di riferimento è migliore, ma la somiglianza non è garantita al 100%.
- I filtri lato server (parole "giovanili", regole fisse) riducono i rischi ma non sostituiscono la moderazione del provider.
- "Cancella tutto" sul telefono: localStorage, IndexedDB, cache e service worker vengono svuotati; `Clear-Site-Data` non è supportato da tutti i browser.
