# Nova — architettura (snapshot WIP)

## Stack

- **Runtime**: Node.js + Express (`server.js`), dati JSON sotto `DATA_DIR` (condivisi Nico/Luisa in `data/shared/`).
- **Client**: PWA statica in `public/` (HTML + CSS + JS moduli, Service Worker `public/sw.js`).
- **AI**: API xAI — chat streaming (`CHAT_MODEL`, fallback), realtime voce (`grok-voice-latest` / `REALTIME_URL`), TTS/STT, image edit, video azioni.
- **Audio iOS**: `navigator.audioSession` play-and-record, `AudioContext` condiviso, worklet `public/js/rt-worklet.js`.
- **Avatar**: canvas 2.5D `public/avatar.js` (respiro WebGL `Breather`, labiale, clip azioni con crossfade).

## File principali

| Percorso | Ruolo |
|----------|--------|
| `server.js` | Auth PIN, personaggi, chat, realtime session, azioni, seed Greta/Chiara, prep solo v8.6 |
| `public/index.html` | Shell UI (lista chat, conversazione, editor, account, galleria) |
| `public/style.css` | Tema WhatsApp-dark, safe area, animazioni fallback avatar |
| `public/js/core.js` | `App`, API, localStorage per utente, chiave xAI solo sul dispositivo |
| `public/js/chat.js` | Lista personaggi, thread condiviso, streaming |
| `public/js/editor.js` | Editor personaggio / regenerate look |
| `public/js/actions.js` | Prep/play movimenti (client); in v8.6 UI prep nascosta |
| `public/js/voice.js` / `realtime.js` / `call.js` | Voce TTS e chiamata realtime + labiale |
| `public/js/account.js` | Chiave, adulti, privacy |
| `public/js/motion.js` / `live.js` | MediaPipe locale (viso/mani); learning da camera da disattivare in solo |
| `public/avatar.js` | Motore disegno avatar |
| `assets/ready/` | Ritratti seed (`greta.jpg`, `chiara.jpg`) |

## Sicurezza / segreti

- Chiave xAI: header `X-AI-Key` dal dispositivo; opzionale file `data/server-ai-key.json` o env `XAI_API_KEY`/`AI_KEY` solo sul server (mai nel zip client).
- Niente `.env`, `SETUP_CODE*`, cartella `data/` o `node_modules` nei pacchetti di rilascio.
- Adulti: consenso vocale di entrambi + toggle; azioni adulti solo con volto AI.

## Flusso v8.6 (previsto)

Login → apri Greta → chat/chiamata realtime (prewarm + web_search) → movimenti già in cache server → modifica aspetto a testo → regenerate + re-prep background.
