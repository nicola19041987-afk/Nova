# Archivio avatar (reversibile)

All’avvio il server esegue una volta la migrazione `avatar_archive_unico_v866` (in `data/migrations.json`).

Cosa fa:

- Segna `archived: true` su ogni personaggio già presente, tranne la Nova scelta (`ready: "nova-scelta"`).
- Copia foto e clip (non le cancella) in `data/avatar-archive/<data-ora>/files/`, con l’elenco in `manifest.json`.
- Cartelle copiate: `shared/avatars`, `shared/actions`, `users/nicola/avatars`, `users/luisa/avatars`. La foto attiva `5ce17a0000000001.jpg` non viene archiviata. La foto bionda e la foto scura restano sul disco con la scheda archiviata.
- Gli originali restano al loro posto. La Galleria totale li mostra ancora, con l’etichetta `archiviato`.
- L’app (foglio, scelta, avatar di default) legge solo le schede senza `archived`.

La Nova visibile è la foto scelta da Nicola (coda, canotta bianca), per Nicola e Luisa. Personalità, carattere, richieste e voce sono vuoti (`configNote: "Da compilare"`).

## Ripristinare un avatar

1. Fermare l’app.
2. Aprire `data/shared/characters.json`.
3. Sulla scheda da rivedere togliere `"archived": true` e `"archivedAt"`.
4. Riavviare. La scheda torna nel foglio e si può scegliere. I file non vanno rimessi a posto: non sono stati spostati.
5. Se un originale mancasse, la copia è in `data/avatar-archive/<data-ora>/files/` con lo stesso percorso relativo indicato nel `manifest.json`. Si ricopia a mano quel file nel percorso originale. Non cancellare la cartella archivio.

La migrazione non si ripete. Un personaggio creato dopo resta visibile finché non lo si archivia a mano con gli stessi campi.
