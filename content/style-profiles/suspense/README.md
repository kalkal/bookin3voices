# Profilo di stile «Suspense/Horror»

Materiale che definisce lo stile delle rifiniture AI. Tutto in italiano, tutto scritto
con esempi e brani inventati. Viene caricato dalla Cloud Function `refineChapter`
(`functions/src/ai/styleProfileContent.ts`).

| File | Cos'è |
|---|---|
| `style-bible.md` | Regole operative dello stile, passate come system instruction |
| `few-shots.md` | Coppie «testo piatto → suggerimento» su scene inventate |
| `golden-set/` | Brani fittizi di prova con esito atteso ciascuno (vedi il suo README) |

## Vincoli

- Niente testi o citazioni estese da opere esistenti: qui vivono regole e brani
  inventati, mai brani di romanzi.
- Ogni modifica a Style Bible/few-shot/prompt/modello → si riesegue l'intero golden
  set (`npm run golden` in `functions/`). Una regressione di stile è un bug.
- Brani veri del libro solo su tier Gemini a pagamento; i brani fittizi di questa
  cartella vanno bene anche sul free in sviluppo.
