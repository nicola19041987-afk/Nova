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
- **Cancella tutto** (Account): cancella con conferma, parola CANCELLA e PIN tutti i dati di entrambi i profili sul server e i dati locali del telefono, poi ti disconnette. I PIN restano, salvo la casella "Cancella anche i PIN". Prima fa un backup completo in `data/backups` (salvo "Elimina anche le copie di sicurezza").

## Archivio condiviso
Nico e Luisa usano **un unico archivio**: stessi personaggi, stesse chat, stessa memoria.
- **Chat di coppia**: per ogni personaggio c'è **un solo thread** (`data/shared/chats/<id>.json`) in cui scrivete entrambi. Ogni messaggio
  registra autore (`nicola` / `luisa` / id del personaggio) e ora, e l'app mostra chi l'ha scritto (Nico / Luisa / nome del personaggio).
  Il personaggio vede la stessa conversazione: nel prompt ogni messaggio inizia con `Nico:` o `Luisa:` e sa chi gli sta scrivendo.
- **➤** invia e fa rispondere il personaggio (con la chiave xAI del telefono di chi scrive). **💬 Solo messaggio** invia solo all'altra
  persona: l'IA non risponde e non serve la chiave.
- **Aggiornamento automatico**: con la chat aperta l'app chiede i messaggi nuovi ogni ~3 secondi (in pausa se l'app è in background) e mostra
  "… sta scrivendo a Nico/Luisa" mentre il personaggio risponde all'altro. Personaggi (aspetto, capelli, guardaroba, info, stato emotivo,
  avatar e storico) e memoria vengono ricontrollati ogni ~7 secondi: se Luisa modifica un personaggio, sul telefono di Nico si aggiornano
  elenco, avatar ed editor (se lo stai modificando anche tu, ti avvisa invece di sovrascrivere le tue modifiche).
- **Memoria condivisa** (`data/shared/memory.json`): la vedete e modificate entrambi ed è quella che usa il personaggio. Le **note personali**
  (Account) restano solo tue e vanno all'IA solo se lo scegli, e solo quando scrivi tu. Restano personali: PIN, consenso vocale, chiave xAI
  (sul telefono), impostazioni privacy, "Le mie regole" (che però il personaggio vede entrambe, perché parla con tutti e due), galleria immagini/video.
- **Modalità adulti (18+)**: interruttore per ciascuno in Account, spento di default e attivabile solo dopo il consenso vocale. Nella chat
  condivisa vale solo se l'avete attivata **entrambi**; per le immagini vale quella di chi genera. Le regole di sicurezza fisse restano sempre attive.
- **Scritture sicure**: ogni file condiviso si modifica uno alla volta (coda per file) rileggendo sempre l'ultima versione, e si salva in modo
  atomico (file temporaneo + rinomina): due messaggi inviati insieme non si perdono. I cambi automatici del look avvengono una sola volta per il personaggio condiviso.
- **Migrazione automatica**: al primo avvio di questa versione i vecchi dati per profilo (`data/users/<profilo>/chats`, `characters.json`,
  `memory.json`, `avatars/`) vengono uniti nell'archivio condiviso (stesso id in entrambi → vince il più recente; messaggi etichettati con
  l'autore originale; l'Aurora iniziale mai usata non viene duplicata). I vecchi file **non vengono cancellati**. Il resoconto è in `data/shared/migration.json`.
- **Cancella tutto** cancella anche chat, personaggi e memoria condivisi.
- **Memoria base del personaggio**: per ogni personaggio con meno di 5 ricordi l'app crea una volta sola (flag `memorySeededAt`) un contesto di
  partenza dai campi dell'editor, con valori predefiniti italiani: chi sono gli utenti (Nico/Nicola e Luisa, coppia, entrambi adulti), come
  riconoscere chi scrive dal prefisso "Nico:"/"Luisa:" e salutarlo per nome, età (25+), carattere, modo di parlare, storia e gusti inventati,
  aspetto, relazione con la coppia. Gli elementi sono marcati **base** in Account (modificabili/cancellabili); nell'editor del personaggio
  **🧠 Rigenera memoria base** li ricrea dai campi attuali. Nessun dato personale preso altrove.
- **Parola chiave per la modalità adulti** (Account, per profilo, vuota = spenta): se la scrivi o la detti in chat, l'avatar chiede a voce
  "Vuoi attivare la modalità adulti? Rispondi sì o no"; con "sì" si attiva solo per il tuo profilo e solo se il consenso vocale è registrato.
  La parola chiave è salvata come hash bcrypt, confrontata sul server e non viene mai salvata in chat né inviata all'IA.
- **Avatar grande e sempre intero (v6)**: il riquadro dell'avatar occupa tutto lo spazio libero della chat (in verticale circa metà
  schermo o più; in orizzontale l'avatar sta a sinistra e la chat a destra). L'immagine è disegnata **intera** (contain, mai ritagliata),
  con un piccolo margine calcolato per oscillazioni e movimenti, nitida su retina (devicePixelRatio, con un tetto di pixel per restare
  fluida su iPhone). Vale anche in modalità compatta (tocca l'avatar) e in 📷 Presenza.
- **Schermo intero** (pulsante ⛶ sull'avatar): usa la Fullscreen API dove esiste; su iPhone (Safari e app installata) apre una
  sovrapposizione che riempie tutto lo schermo rispettando le aree sicure; si esce con ✕.
- **🎬 Scena cinematografica** (pulsante sull'avatar, scelta salvata su questo telefono per personaggio): inquadratura larga con
  lei a figura intera in una stanza: 🛋️ divano/salotto, 🛏️ camera da letto, 🌇 terrazza. Con **✨ Genera figura intera con l'IA**
  l'app chiede a xAI (con la chiave del telefono) una versione 16:9 a figura intera, seduta nella stanza scelta, luce cinematografica,
  adulta 25+, ancorata all'identità del personaggio; viene salvata come immagine "scena" del personaggio (condivisa), oppure resta
  un'anteprima da confermare se il salvataggio automatico è spento. Il viso viene trovato **sul telefono** (MediaPipe locale) e
  l'animazione continua sulla scena: respiro, piccola oscillazione della testa, ammiccamenti, labiale, microespressioni (scalati
  alla dimensione del viso). Senza immagine generata si vede una stanza illustrata localmente (solo canvas, nessuna risorsa esterna)
  con l'avatar attuale sfumato al centro.
- Il vecchio **comodino con cassetto** è stato rimosso: l'impostazione `drawerScene`, lo stato e gli eventuali messaggi già salvati
  vengono ignorati (mai mostrati né passati all'IA).

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
| Tracciamento locale (viso, mani, corpo), gesti, ritmo | `public/js/motion.js` (+ modelli in `public/vendor/mediapipe/`) |
| Chat condivisa e sincronizzazione | `public/js/chat.js`; server: sezione `chat CONDIVISA` in `server.js` |
| Voce (dettatura e lettura) | `public/js/voice.js` |
| Grafica | `public/style.css`; icone: `npm run icons` (`scripts/make-icons.js`) |
| Frase del consenso vocale | `server.js` → `CONSENT_PHRASE` |
Il server è un solo file diviso in sezioni commentate (`// ---------- ... ----------`); il frontend è HTML/CSS/JS semplice, senza build.
Dopo modifiche al frontend aumenta il numero di versione `CACHE` in `public/sw.js`.

## Dati
Tutto in `data/` sul server (escluso da git e dallo zip): `pins.json`, `sessions.json`, `shared/` (personaggi, chat, memoria, avatar, Diario),
`users/<profilo>/…` (consenso audio, impostazioni, regole, note personali, immagini, video; più i vecchi file prima della migrazione). Fai un backup di questa cartella.

### Protezione dei dati (v6.1)
- **Copie di sicurezza automatiche** in `data/backups/<data>-<motivo>/`: all'avvio, ogni ora (se qualcosa è cambiato), al massimo ogni 10 minuti mentre si modificano i personaggi, e sempre prima di eliminare un personaggio, svuotare una chat, recuperare personaggi o fare "Cancella tutto". Contengono personaggi, chat, memoria, Diario, avatar (hard link: nessuno spazio in più) e i vecchi file per utente. Si tengono le ultime `BACKUP_KEEP` (predefinito 20) più le ultime 10 fatte prima di un'operazione distruttiva.
- **Mai un elenco vuoto per errore**: se `characters.json` (o un altro archivio) è illeggibile, il file viene messo da parte in `data/backups/illeggibili/` e ripristinato dalla copia speculare `.bak` o dall'ultimo backup; se non c'è una copia valida la modifica viene bloccata (errore 503) e il file NON viene toccato. Una scrittura che toglierebbe personaggi dall'elenco viene bloccata, salvo l'eliminazione esplicita di quel singolo personaggio.
- **Registro**: eliminazioni di personaggi, chat svuotate, recuperi e "Cancella tutto" finiscono nel log del server (`[registro] …`) e in `data/audit.json` (utente, id, nome, ora).
- **Recupero personaggi** (Account → 🛟): elenca i personaggi che non sono più nell'elenco ma esistono nei vecchi file per utente o nei backup, e li rimette **accanto** a quelli attuali con la loro chat e i loro avatar (stesso id già presente = saltato; nulla viene sovrascritto). All'avvio della v6.1 il recupero viene fatto una volta in automatico (segno `data/shared/recovery-v61.json`); gli avatar rimasti senza personaggio vengono aggiunti allo storico look del personaggio recuperato.
- **Cancella tutto** fa prima un backup completo (che resta in `data/backups`), a meno di spuntare "Elimina anche le copie di sicurezza".
- Su Render il disco persistente deve essere montato esattamente sulla cartella dati (`DATA_DIR`): controlla che il percorso di mount e `DATA_DIR` coincidano.

## Gesti e imitazione con la fotocamera (sul telefono)
In **📷 Presenza**: **✋ Gesti** fa reagire l'avatar alle tue mani (👋 saluto → saluta, ✋ mano aperta / ✌️ → sorride, 👍 / 👌 → annuisce,
👉 → inclina la testa); **🪞 Imita i miei movimenti** riprende inclinazione e cenni della testa, braccia alzate e il ritmo con cui ti muovi,
in modo naturale e non come una copia: con 300–800 ms di ritardo (variabile), solo in parte (circa 35–65% dell'ampiezza) e con movimenti
morbidi (molle smorzate). L'avatar impara il tuo stile (medie di energia, ampiezza dei movimenti della testa, tempo dei gesti, frequenza dei gesti
delle mani), salvato **solo su questo telefono e per profilo** (`motionStyle`, mai inviato al server; Account → "Dimentica il mio stile di
movimento"), e lo usa anche a fotocamera spenta per il comportamento a riposo (oscillazione, sguardi altrove, piccoli gesti). In più
microespressioni: sopracciglia che si alzano, saccadi dello sguardo, sorrisi accennati, ammiccamenti di durata variabile (a volte doppi o a metà).
Il tracciamento è limitato a ~14 fotogrammi al secondo su iPhone.
Usa MediaPipe Tasks Vision (Face/Hand/Pose Landmarker, modelli float16 inclusi in `public/vendor/mediapipe/`), con GPU (WebGL2) e ripiego su CPU.
I file `wasm` vengono copiati da `node_modules` a ogni `npm install` (`scripts/setup-vendor.js`, nessun download): sono esclusi da git
perché pesano ~27 MB. Nessun fotogramma lascia il telefono.

## Estensione facoltativa NON inclusa: scambio volto di alta qualità
Uno scambio volto realistico in tempo reale (InsightFace / ReActor) non gira nel browser di un telefono. Si potrebbe aggiungere
un piccolo servizio separato su una macchina con GPU (Python + InsightFace `inswapper`) che riceve due immagini e restituisce il risultato,
chiamato da `server.js` al posto di `/images/edits` in `/api/faceswap`, mantenendo gli stessi controlli (dichiarazione obbligatoria, solo Nico/Luisa o volti IA).
Non è installato né configurato.

## Limiti onesti (approssimato / non testato)
- **Non testato con la vera API xAI** (nessuna chiave usata): chat, memoria automatica, evoluzione della personalità, immagini, modifiche immagine, video e didascalie sono scritti secondo la documentazione xAI ma non provati end-to-end. Il formato multi-immagine di `/images/edits` (campo `images`) e `response_format` sono ipotesi ragionevoli.
- **Labiale** approssimato (eventi `boundary` + stima delle sillabe); su iOS gli eventi spesso mancano e si usa una simulazione a tempo. L'analisi audio reale (AnalyserNode) è pronta ma usata solo se si riproduce un audio.
- **Gesti dell'avatar** approssimati (2.5D): le zone delle braccia ruotano attorno alle spalle. Riconoscimento dei gesti delle mani e imitazione
  funzionano con MediaPipe sul telefono, ma la resa e la velocità su iPhone vanno provate dal vivo (su iPhone l'elaborazione è limitata a ~14 fotogrammi al secondo).
- **Volto dal vivo**: sovrapposizione 2D (trasformazione su 3 punti + maschera ovale sfumata), non un vero face swap; non testato su iPhone/Android reali (provato solo in Chrome desktop con fotocamera finta). Su iPhone, in modalità app dalla Home, la fotocamera può comportarsi in modo diverso: se non parte, aprila da Safari.
- **Riconoscimento vocale**: su Chrome usa il servizio online del produttore del browser (non funziona offline); su iOS/Safari il supporto è parziale.
- **Identità stabile**: dipende dal modello; con immagine di riferimento è migliore, ma la somiglianza non è garantita al 100%.
- I filtri lato server (parole "giovanili", regole fisse) riducono i rischi ma non sostituiscono la moderazione del provider.
- "Cancella tutto" sul telefono: localStorage, IndexedDB, cache e service worker vengono svuotati; `Clear-Site-Data` non è supportato da tutti i browser.
