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

## Azioni dell'avatar (v7)
- **Più movimento a riposo**: oscillazione, girate della testa, spostamento del peso e spalle (una sale mentre l'altra scende) più ampi; il margine del riquadro è calcolato sul movimento massimo, quindi l'avatar resta intero (verificato su 375×667, 390×844, 430×932 in verticale e orizzontale).
- **🎭 Azioni** (pulsante sul riquadro): si sistema i capelli, si stiracchia, beve un caffè, ride, saluta con la mano, si appoggia e si gira, manda un bacio. Si preparano **solo** con «Prepara azioni…» (consumano crediti xAI della chiave di chi le prepara; avanzamento mostrato, interrompibile; al massimo `ACTION_MAX_HOUR` preparazioni l'ora per profilo).
  - Con il video xAI (`/v1/videos/generations`, modello `ACTION_VIDEO_MODEL`, predefinito `grok-imagine-video-1.5`, 480p, `ACTION_SECONDS` = 5 s): clip da immagine a video a partire dall'avatar attuale, con l'ultimo fotogramma fissato uguale al primo, così torna esattamente all'avatar. Se il modello non accetta l'ultimo fotogramma, si riprova senza.
  - Se il video non è disponibile (`VIDEO_PATH` vuoto o servizio che risponde 404/501): **pose** (immagini) create con la modifica immagine dal volto di riferimento, nello stesso formato dell'avatar, animate con dissolvenza, lento Ken Burns e labiale/ammiccamenti sul viso trovato sul telefono (MediaPipe).
  - Riproduzione nel riquadro dell'avatar (disegnata nel canvas con gli stessi movimenti: niente ritagli), dissolvenza in entrata e ritorno all'avatar vivo. Non durante la scena cinematografica.
  - **Spontanee**: a chat aperta, se è inattiva da almeno 45 s, al massimo una ogni 2,5 minuti e 8 l'ora (disattivabili dal menu 🎭, per telefono).
  - **Dalla chat**: il personaggio può aggiungere `[azione:saluta]` (solo azioni pronte, elencate nel prompt di sistema). Il tag viene tolto dal testo salvato e l'azione parte su entrambi i telefoni.
  - Le azioni preparate con un avatar precedente risultano «da rifare» e non vengono riprodotte.
- **Azioni per adulti** («si spoglia», «scena intima con sex toy», personaggio inventato adulto 25+): esistono solo con la modalità adulti attiva per **entrambi** (come la chat per adulti) e **solo per personaggi con il volto generato dall'IA**, mai partendo da una foto caricata (anche un avatar IA rigenerato da una foto resta escluso: il consenso foto registrato non si cancella). Si preparano solo con «Prepara azioni…», non partono mai da sole a modalità spenta; se l'altra persona spegne la modalità spariscono subito (file negati dal server, nessuna cache nel browser). Rifiuti di moderazione: «Contenuto rifiutato dal servizio AI» e resta l'avatar normale. Regola di base sempre in testa al prompt.
- Le clip e le pose stanno in `data/shared/actions/`: «Cancella tutto» le elimina e **non** vengono copiate nei backup automatici.

## Cornice dell'avatar (v7.1)

- **Cornice verticale fissa 9:16** (come lo schermo del telefono), alta quanto lo spazio disponibile: in chat, a schermo intero, in modalità compatta e in Presenza; in orizzontale resta una cornice verticale a tutta altezza a sinistra, con la chat a destra.
- **Niente oscillazione**: il riquadro e la foto non si spostano più (nessuna rotazione, traslazione o deriva laterale). Restano solo animazioni interne leggere: respiro (deformazione verticale minima del busto), labiale, ammiccamenti, sguardo, sopracciglia, sorrisi. Disattivati i "gesti" che ruotavano pezzi di braccio della foto (creavano giunture).
- **Mai ritagliata**: ogni foto è disegnata intera (contain) con il suo formato, la più grande possibile; lo spazio avanzato è riempito da una copia sfocata e statica della stessa foto, con bordi sfumati (niente rettangolo netto). Al cambio foto c'è una dissolvenza (niente salti di dimensione).
- Le azioni v7 (clip e pose) e le protezioni dei dati v6.1 sono invariate.

### Correzioni v7.2 (iPhone Safari)
- Sfondo sfocato fatto dal browser (CSS `filter: blur()` su un elemento dietro al canvas): liscio su iPhone, niente blocchi né copie ingrandite con bordi netti. Il canvas resta trasparente intorno alla foto e ne sfuma i bordi.
- La foto è disegnata in un colpo solo (niente più strisce orizzontali → niente giunture).
- Labiale/occhi/sopracciglia scalati sulla distanza reale fra gli occhi: su foto a figura intera non compare più la striscia scura sulla fronte; palpebre con bordo sfumato.
- L'anteprima nell'editor «Modifica» usa la stessa cornice verticale 9:16 della chat.

### Audio su iPhone (v7.3)
- La voce dell'avatar è la sintesi vocale del telefono (speechSynthesis): nessun audio passa dal server.
- iOS (Safari e app installata) scarta in silenzio la prima lettura se non parte dentro un tocco: le risposte arrivano dopo la rete, quindi restavano mute. Ora il primo tocco qualsiasi sblocca l'audio (contesto audio riattivato, buffer muto, sintesi "scaldata"). Se una lettura viene comunque bloccata compare **🔊 Tocca per attivare l'audio**: un tocco la ripete.
- «Lettura» è accesa di default (chi l'ha spenta a mano resta spenta); accendendola si sente «Lettura attiva.». Sull'app installata le preferenze sono separate da quelle di Safari.
- Le clip delle azioni suonano con il loro audio (se presente) solo con Lettura attiva e audio sbloccato; se iOS lo blocca, la clip parte muta.
- Sul telefono: interruttore laterale (silenzioso) disattivato e volume alzato; su iPhone la sintesi vocale può restare muta in modalità silenziosa.

## Novità v8.4.2 (correzione «Errore 422» sulle voci)

- **Causa**: dalla v8.4.1 la richiesta di sintesi vocale a xAI (`POST /v1/tts`) inviava `optimize_streaming_latency` come stringa (`"1"`), mentre lo schema ufficiale vuole un intero (0/1/2): xAI rispondeva 422 a ogni «Prova la voce» e a ogni frase letta. Ora è l'intero `1`; tutti gli altri campi (`voice_id`, `language: "it"`, `speed` 0,7–1,5, `output_format` mp3/24000/64000) sono stati verificati sulla documentazione.
- **Più robusto**: se xAI rifiuta comunque la richiesta (400/422) il server riprova una volta con i soli campi base (testo, voce, lingua); se la voce non esiste (404) riprova con «eve». Le voci non valide (es. «una») diventano «eve»; l'id voce è inviato in minuscolo.
- **Errori leggibili**: al posto di un 422 «nudo» compare il motivo vero in italiano (es. «Richiesta non accettata dal servizio AI (422): …campo…»). Le risposte di errore di voce, elenco voci, trascrizione e token del tempo reale indicano la chiamata fallita, lo stato HTTP di xAI e il corpo della risposta, ripulito da chiavi e token.
- **Diagnostica voce**: per ogni riga in errore mostra la chiamata, lo stato HTTP e la risposta di xAI; c'è una nuova riga «Elenco voci xAI», che controlla anche se la voce scelta esiste.
- Tempo reale: tolto l'aggiornamento extra con un modello di trascrizione non previsto dallo schema (si usa quello predefinito).
- **Nuova icona** «Nova» (monogramma N con stella a quattro punte su sfondo blu notte → viola, opaca come vuole iOS): `public/icons/icon-1024.png`, `icon-512.png`, `icon-192.png`, `icon-180.png` (apple-touch-icon), `icon-maskable-512.png` (margine di sicurezza per Android), `favicon.svg`/`favicon-32.png`. Su iPhone l'icona resta in cache: per vederla bisogna togliere l'app dalla schermata Home e aggiungerla di nuovo (Safari → Condividi → Aggiungi alla schermata Home).
- **Modelli pronti completi**: Giada, Elena, Vera e Marta compilano ora tutti i campi dell'editor (anche corporatura, altezza, inquadratura, colori dell'avatar, trucco, dettagli del look e un look alternativo nel guardaroba); tutto resta modificabile.
- Cache dell'app: `app-privata-v8-4-2`.

## Novità v8.4.1 (chiamate senza "bip", tempo reale corretto, diagnostica, elimina/importa personaggio, avatar più lontano e fluido)

- **Tempo reale corretto secondo la documentazione xAI** (`wss://api.x.ai/v1/realtime`, token da `POST /v1/realtime/client_secrets`,
  sottoprotocollo `xai-client-secret.<token>`): la configurazione della sessione ora contiene solo campi previsti dallo schema
  (`turn_detection: {type:'server_vad'}`, `audio.input/output.format {audio/pcm, 24000}`, `transcription {language_hint, keyterms}`).
  In v8.4 c'erano campi non previsti (`threshold`, `silence_duration_ms`, `prefix_padding_ms`, `transcription.model`) e la voce `una`
  (non esiste): il servizio rispondeva con un errore e il telefono passava alla chiamata classica. Ora gli errori non sono fatali,
  la configurazione viene ritentata a passi e il motivo esatto (codice di chiusura, messaggio) viene mostrato. Token valido 5 minuti.
- **Indicatore in chiamata**: in alto «⚡ Tempo reale» o «Classica» (toccalo per il motivo).
- **Impostazioni → Voce → 🩺 Diagnostica voce**: prova chiave, token, WebSocket, configurazione, microfono, trascrizione e voce, con i tempi.
- **Niente "suono di attacco e stacco"**: in chiamata il riconoscimento vocale del telefono non viene più fermato/riavviato a ogni frase.
  La chiamata classica usa un microfono sempre aperto (cancellazione eco, riduzione rumore, guadagno automatico), un rilevatore del
  parlato proprio e la trascrizione xAI (`POST /api/stt` → `/v1/stt`); la voce di lei suona sull'unico AudioContext con dissolvenze;
  la sessione audio iOS resta «play-and-record» per tutta la chiamata. Funziona anche su Android Chrome.
- **Chiamata classica più veloce**: modello senza ragionamento per le risposte in chiamata (`CALL_MODEL`, predefinito
  `grok-4.20-0309-non-reasoning`, si torna a `CHAT_MODEL` se non disponibile), risposte brevi, voce con `optimize_streaming_latency`,
  connessioni pre-aperte mentre stai ancora parlando.
- **🗑️ Elimina personaggio** (solo Nicola, in fondo all'editor del personaggio): doppia conferma (scrivere il nome); prima una copia
  di sicurezza completa e il cestino del personaggio; vengono tolti solo lui, la sua chat, i suoi ricordi di base e le sue foto.
  Ripristinabile per 7 giorni da Impostazioni → Recupero personaggi → «Personaggi eliminati».
- **📋 Importa personaggio da testo** (solo Nicola, editor di un nuovo personaggio): l'IA compila i campi da una descrizione libera,
  da rivedere prima di salvare. Sempre adulti (25+) e inventati; le regole per adulti non cambiano.
- **Avatar più lontano, fluido e naturale**: distanza dalla camera regolabile (predefinita «lontana», testa ≈ 21% dell'altezza),
  60 fotogrammi al secondo costanti, smorzamenti indipendenti dal frame rate, cenni del capo mentre ascolta (vari), micro-movimenti
  verticali a strati, geometria in cache; tempi dei fotogrammi misurabili (`App.avatarConv.perf()`).

## Novità v8.4 (aspetto iPhone, chiamate in tempo reale, Galleria, ruoli)

**Conversazione in tempo reale (voce e videochiamata)**
- Nuovo motore «⚡ Conversazione in tempo reale» (Impostazioni → Voce → *Motore delle chiamate*; predefinito). Usa la **Voice Agent API di xAI** (`wss://api.x.ai/v1/realtime`, modello `grok-voice-latest`), come la modalità vocale di Grok: microfono in streaming continuo (PCM 24 kHz), fine frase rilevata dal server (VAD, ~500 ms di silenzio), voce che arriva in streaming e parte subito, **interruzione** (se parli mentre lei parla, lei si ferma), labiale guidato dall'audio in arrivo.
- La sessione riceve le stesse istruzioni delle chiamate normali: personalità, regole, memoria, ultimi messaggi, voce del personaggio. Le regole per adulti restano identiche e attive solo quando la modalità adulti è attiva per entrambi (e con il consenso personale di Luisa); si aggiornano anche a chiamata in corso.
- Le frasi dette (tue e sue) vengono salvate nella chat come trascrizione (`rt: true`, interrotte segnate con «…»).
- **La chiave xAI resta sul telefono**: il server la usa solo per chiedere a xAI un token temporaneo (60 s) per la singola chiamata (`POST /api/realtime/session`) e **non la salva**; il browser si collega direttamente a xAI con quel token.
- Se il tempo reale non è raggiungibile (rete, chiave, servizio), la chiamata passa da sola alla **chiamata classica** con un avviso.
- Anche la chiamata classica è più veloce: fine frase dopo ~600 ms di silenzio, risposta in streaming, voce che parte dalla prima frase (o dal primo inciso), connessione «calda», stato «Sta parlando…» subito.
- Impostazioni → Voce mostra la **latenza misurata** (fine del tuo parlato → primo suono di lei) per i due motori.
- Nota onesta: il tempo reale è implementato seguendo la documentazione xAI e provato con un server di prova locale che parla lo stesso protocollo; il servizio xAI vero non era raggiungibile dall'ambiente di sviluppo.

**Aspetto iPhone**
- Tema scuro iOS (carattere di sistema, titoli grandi, barre traslucide, liste raggruppate, interruttori iOS, margini sicuri) e barra delle schede in basso: **Chat · Chiamate · Galleria · Impostazioni** (si nasconde in conversazione, in chiamata, a schermo intero e nel visore).
- **Schermata Home** con widget orologio, sfondo, icone e dock. Diario, Crea e **Grok** (apre grok.com) dalla griglia; Calcolatrice, Appunti e Mail sono decorative (tremano, non si aprono).
- Barra di stato finta (ora, segnale, wi-fi, batteria reale se il browser la fornisce) solo nel browser; nell'app installata si vede quella vera di iPhone.
- Chat e chiamate restano in stile WhatsApp.

**Chiamate**: registro delle chiamate vocali e video (tutte / video / vocali), tocca per richiamare.

**Galleria**
- «＋ Aggiungi» apre il selettore foto di iPhone: le foto e i video scelti vengono copiati nello spazio privato del tuo profilo (Safari vede solo quello che scegli, non tutto il rullino).
- Sezione con le immagini dell'app (avatar, scene, immagini e video creati).
- Visore a tutto schermo con scorrimento, Condividi/Salva, «Usa come foto avatar» (solo Nico), «Invia in chat».
- Eliminare chiede sempre conferma; gli elementi eliminati vanno in «Eliminati di recente» (ripristinabili).

**Personaggi**
- Testi di partenza (personalità, stile, descrizione) coerenti con le regole; «✍️ Riempi con base» completa **solo i campi vuoti**.
- 4 modelli pronti accanto a «＋ Nuovo» (donne adulte immaginarie, 25–40 anni): solare e ironica, dolce e romantica, decisa e sarcastica, tranquilla e intellettuale. Ogni modello crea un **nuovo** personaggio modificabile con nome, testi, voce consigliata e descrizione per la foto (la foto si genera con «✨ Rigenera avatar» e la tua chiave).
- Voce per personaggio.

**Cornice 9:16 senza sfocature**: tolte tutte le sfocature della foto (cornice, chiamate, editor). La foto riempie la cornice tagliando al massimo ~12% per lato e mai la testa; il resto è riempito coi colori dei bordi. Se la foto è molto fuori formato, una volta sola l'IA la allarga a 9:16 («🖼️ Adatta alla cornice», annullabile con «↩︎ Foto originale» nell'editor). La cornice resta ferma.

**Viso più realistico**: ammiccamenti ogni 2–6 s (a volte doppi, chiusura rapida e riapertura più lenta), palpebra vera presa dalla pelle della foto con ombra e ciglia, palpebre a volte rilassate, saccadi e micro-movimenti, sguardo in camera mentre parla, ammiccamenti con i grandi spostamenti di sguardo; bocca con forme diverse per sillaba, interno scuro a lente, accenno dei denti, angoli che seguono il sorriso, tutto ancorato ai punti del viso.

**Ruoli (controllati dal server)**
- **Nico è l'amministratore**: solo lui può creare, modificare o eliminare personaggi, modelli, regole, descrizioni, voci, scene, gesti, foto avatar, impostazioni dell'app, attivare o disattivare funzioni e sblocchi, cancellare memorie ed eliminare elementi condivisi. Il server risponde 403 a Luisa su queste operazioni (non è solo nascosto).
- **Luisa** può chattare, chiamare (voce e video), usare la Galleria (aggiungere le sue foto, vedere, inviare in chat) e **regalare memorie** (vengono aggiunte alla memoria del personaggio; non può modificare o cancellare quelle esistenti). Nell'app i comandi di modifica sono nascosti o disattivati con la nota «Solo Nicola può modificare».
- Modalità adulti: la gestisce Nico, ma resta obbligatorio il **consenso personale di Luisa** (una volta) prima che i contenuti per adulti la coinvolgano nelle chat condivise; lei può sempre revocarlo.
- Per cambiare l'amministratore: variabile `ADMIN_USER` (`nicola` predefinito).

## Novità v8.3.1 (correzione modalità adulti)

- Impostazioni → «Modalità adulti (18+)» ora mostra lo stato di **entrambi** (✅ attiva / ⏳ non ancora / manca il consenso vocale) e dice esattamente cosa manca, per esempio «Manca il consenso di Luisa: deve accedere con il suo profilo → Account → Modalità adulti (18+)».
- L'interruttore si carica subito, anche se regole, memoria o note non si caricano.
- Regole invariate: nelle chat di coppia i contenuti per adulti valgono solo quando l'avete attivata tutti e due.

## Novità v8.3 (seduta al tavolo e gesti spontanei)

- **Lei seduta al tavolo del soggiorno**: foto realistica generata dall'IA (stesso viso, inquadratura da videochiamata 9:16, il telefono appoggiato sul tavolo), creata **una volta sola** per personaggio con la chiave xAI del telefono. Avatar, messaggi e vecchie scene restano intatti; per le scene già esistenti viso, spalle e linea del tavolo vengono ritrovati sul telefono senza toccare i vecchi dati.
- **Respiro da seduta**: petto e spalle si muovono, si ferma alla linea degli avambracci appoggiati; tavolo e stanza restano fermi.
- **Gesti spontanei** (si sistema i capelli, tossisce, starnutisce, ride): brevi clip generate dalla foto al tavolo, fuse con l'immagine e sincronizzate con il respiro (inspira prima dello starnuto, riprende fiato dopo la tosse). Rari (al massimo uno ogni 2,5 minuti), mai lo stesso due volte di fila. In chiamata solo quando c'entrano: la risata quando ride davvero, dopo la frase; i capelli quando è tenera o maliziosa.
- Le azioni per adulti e gli sblocchi restano come prima, sull'avatar; nella scena al tavolo ci sono solo i gesti.

Cosa toccare: apri la chat → 🏠 → «✨ Crea la scena al tavolo con l'IA» (conferma se chiede di salvare) → lei appare seduta; poi 🏠 → «🎬 Prepara i gesti al tavolo» → «Prepara». Per tornare all'avatar di sempre: 🏠 → «✓ Seduta al tavolo — tocca per spegnere».

## Novità v8.2 (stile WhatsApp)

- **Chat**: intestazione con foto rotonda, nome e stato (online / sta scrivendo… / in chiamata) e icone 📞 📹; bolle verdi a destra per i tuoi messaggi, scure a sinistra per lei e per l'altra persona (con il nome colorato), ora e spunte in basso (✓ inviato, ✓✓ consegnato in chat, ✓✓ blu quando c'è una risposta dopo).
- **Chiamata vocale (📞)**: la sua foto sfocata a tutto schermo, ritratto rotondo vivo (respiro, labiale e sguardo continuano), alone che pulsa con la sua voce, timer, altoparlante / microfono / chiudi. Voce a mani libere come nella videochiamata; lei sa che è una telefonata (non ti vede).
- **Videochiamata (📹 o tasto verde nella chiamata vocale)**: passa dal vocale al video senza riagganciare (il timer continua); riquadrino della tua fotocamera in alto a destra e barra in basso stile WhatsApp. Cornice 9:16 fissa e intera.
- L'altoparlante usa la sessione audio del browser dove esiste (iPhone), altrimenti abbassa il volume.
- Nessun cambiamento ai dati, agli sblocchi o alla modalità adulti.

## Novità v8.1 (respiro realistico, conversazione più naturale)

**Respiro e profondità (sul telefono, nessun dato esce):**
- Respiro naturale sulla foto: 12–16 respiri al minuto con variazioni (inspirazione più rapida, espirazione più lenta, breve pausa, ogni tanto un respiro più profondo).
- Salgono spalle e petto, la testa sale insieme alle spalle; il petto si espande appena verso chi guarda (effetto pseudo-3D con una leggera luce). Il bordo inferiore resta ancorato: niente vuoti, niente giunture, niente movimenti laterali, inquadratura 9:16 fissa e mai tagliata.
- Deformazione morbida in WebGL (un solo passaggio). Con MediaPipe Pose vengono rilevati spalle, fianchi e una maschera della persona a bassa risoluzione (~96 px), così lo sfondo resta perfettamente fermo. Se WebGL non c'è, resta il respiro semplice di prima.
- Accoppiato alla voce: prende fiato (bocca appena socchiusa) prima di parlare, espira piano mentre parla, riprende fiato tra le frasi; sospiro con l'umore triste o con "uff", piccoli sobbalzi del petto quando ride.
- Migrazione automatica e non distruttiva: le foto già rilevate vengono rianalizzate una volta per aggiungere i dati del corpo (`landmarks.v = 2`, `landmarks.body`); i punti messi a mano restano.

**Conversazione:**
- Il nome di chi scrive viene usato di rado: se è già comparso nelle ultime risposte, l'IA è avvisata e un filtro in streaming toglie gli appellativi ("Nico, …", "…, Luisa?", "Ciao Nico!"), lasciando le menzioni normali.
- Registro naturale; parolacce solo quando il contesto le richiede davvero.
- Se si offende (`[umore:offesa]`) lo mostra in modo umano e breve; l'offesa si attenua da sola a ogni scambio (dopo 2–4 è passata), senza mai bloccare la conversazione.
- Sblocchi e modalità adulti invariati; l'intimità continua a nascere in modo graduale dal flusso della conversazione.

## Novità v8 (videochiamata, voce naturale, memoria)

- **📹 Videochiamata**: pulsante verde in chat. Lei a tutto schermo nel riquadro 9:16 fisso, timer, microfono, fotocamera (riquadrino, resta sul telefono), sottotitoli (CC) e riaggancia. Ascolto continuo con invio automatico; mentre lei parla l'ascolto è in pausa (niente eco); tocca il suo viso per interromperla. Se il riconoscimento vocale non è disponibile (alcune versioni di iPhone/PWA) compare una casella per scrivere o dettare con la tastiera.
- **Voce naturale xAI** (`POST /api/tts`, `GET /api/tts/voices`): la chiave resta sul dispositivo e viene solo inoltrata; il testo non viene registrato. Lettura frase per frase mentre la risposta arriva, labiale guidato dall'ampiezza reale dell'audio, un solo elemento audio sbloccato al primo tocco (su iPhone suona anche col tasto silenzioso, iOS 17+). Se xAI non risponde si passa da soli alla voce del telefono. Impostazioni in Account → "Voce dell'avatar" (motore, voce, velocità, prova).
- **Chat più naturale**: riassunto progressivo delle parti vecchie della chat (`POST /api/chats/:id/summarize`, campo `summary` nel file della chat, nessun messaggio cancellato), anti-ripetizione (inizi delle ultime risposte), stile da telefonata in videochiamata, ricordi automatici senza doppioni.
- **Linguaggio del corpo contestuale**: l'IA può iniziare la risposta con `[gesto:…]`/`[umore:…]`; i tag vengono tolti dal testo e salvati nel messaggio (`gesture`, `mood`). Niente azioni spontanee a caso in videochiamata; le azioni per adulti non partono mai da sole.
- **Intimità graduale** (solo con modalità adulti attiva per entrambi, regole invariate): istruzioni esplicite per un'escalation lenta e reciproca, verifiche, de-escalation e nessuno scatto da una parola cruda fuori contesto.
- **Occhi e bocca automatici**: MediaPipe (locale) trova occhi, sopracciglia e bocca sulla foto (anche a figura intera, riprovando sulla parte alta ingrandita). Salvati in `landmarks` con `auto: true`; i vecchi segni a mano restano in `landmarks.manual`. Migrazione una tantum in background per gli avatar esistenti (`PUT /api/characters/:id/landmarks`, applicato solo se l'avatar è ancora quello). I segni manuali sono sotto "Correggi a mano".
- **Una sola scena: il soggiorno** (foto realistica 9:16 generata con lei dentro, stessa luce). Le vecchie scene (salotto, camera, terrazza) restano nei dati e su disco ma non si usano più; le stanze disegnate sono state tolte.
- **Velocità/stabilità**: a riposo l'avatar disegna ~30 fps, avatar e clip in cache 30 giorni (nomi immutabili), service worker con riserva offline più sicura (cache `app-privata-v8`), messaggi d'errore xAI più chiari (429, 5xx, voce, immagine).

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
