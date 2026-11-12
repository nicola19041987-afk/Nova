# N&N — Collaborazione NN

Chat stile WhatsApp dove Nico appunta le sue idee (testo o vocale tenendo premuto il microfono).
L'assistente (xAI Grok) risponde in italiano e salva ogni idea con titolo, descrizione, data e stato.
Nicola vede tutto in tempo reale (SSE + polling di riserva ogni 2 s).

- Accesso: link segreti `https://<servizio>/?k=<NN_TOKEN_NICO>` e `?k=<NN_TOKEN_NICOLA>` (token casuali, solo env var su Render).
- PIN facoltativo per Nico: env var `NN_NICO_PIN` (se vuota, nessun PIN).
- Dati: file JSON in `DATA_DIR` (disco Render) oppure Postgres se c'è `DATABASE_URL`.
- Niente segreti nel repo: `.env`, `data/` e `node_modules/` sono ignorati. `noindex` + `robots.txt` Disallow.
- Token: `npm run gen-tokens`.
