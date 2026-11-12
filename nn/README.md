# Luisa e Nico

Clone di N&N Ideas con lo stesso codice e dati completamente separati (servizio, disco e chiavi VAPID propri).
Chat stile WhatsApp con l'assistente Idea: testo, foto, documenti, vocali veri con risposta vocale, chiamata vocale
che finisce con il saluto di Idea, e Idea che chiama l'altra persona su richiesta (notifiche push + schermata di chiamata in arrivo).

- Utenti: Nico (proprietario/admin, `NN_TOKEN_NICOLA`) e Luisa (`NN_TOKEN_NICO`). I nomi delle env var restano quelli di N&N.
- Accesso: password a 4 cifre o link `https://<servizio>/?k=<token>`; dopo il primo accesso resta collegato (cookie HttpOnly).
- Dati: file JSON in `DATA_DIR` (disco Render) oppure Postgres se c'è `DATABASE_URL`.
- Niente segreti nel repo: `.env`, `data/` e `node_modules/` sono ignorati. `noindex` + `robots.txt` Disallow.
