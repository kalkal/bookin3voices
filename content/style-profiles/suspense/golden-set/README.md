# Golden set — brani di prova per il profilo «Suspense/Horror»

Sei brani **fittizi** (scritti apposta, nessun testo reale del libro né di opere
esistenti), con **dettatura simulata**: frasi lunghe, punteggiatura scarsa, qualche
attacco senza maiuscola. Generi e toni diversi, perché il profilo deve reggere su
registri diversi senza appiattirli.

| File | Tono | Cosa mette alla prova soprattutto |
|---|---|---|
| `01-la-caldaia.md` | tensione domestica | avverbi, verbi filtro, emozione dichiarata, refrain da NON toccare |
| `02-la-cucina-di-mamma.md` | dialogo | attribuzioni → «disse», parlato colloquiale da NON correggere |
| `03-il-pozzo.md` | memoir, voce ricca | −10% mirato, anafora da NON toccare, densità bassa |
| `04-il-parcheggio.md` | azione | filtri, passivo, punteggiatura da dettatura, frase lunga «di fiato» da NON smontare |
| `05-la-cassa-tre.md` | quotidiano che si incrina | mostrare vs dichiarare, concretezza senza inventare fatti |
| `06-le-magnolie.md` | perturbante quotidiano, brano lungo | densità sul tetto, refrain ×4, ripetizione ravvicinata voluta, paragrafo-fiume |

## Come si usa

- **Runner automatico (dalla callable refineChapter)**: `npm run golden` in `functions/` esegue TUTTI i
  brani contro il prompt corrente (Style Bible + few-shot + regole di formato di
  `refinePrompt.ts`) e verifica meccanicamente densità, zone «NON DEVE» (da
  `checks.json`, che deve restare allineato ai brani — il runner esplode se
  divergono), gerarchia grammar e formato; la copertura dei «DEVE» è riportata come
  diagnostica. Chiave da env `GEMINI_API_KEY`, SOLO brani
  fittizi sul tier free. Opzioni: `-- --model X --fallback Y --only 04 --out report.md --dry`.
- Per una prova manuale (es. in Google AI Studio): incollare Style Bible e few-shot come
  system instruction e, come messaggio, solo la sezione «Brano», mai l'«Esito atteso».
- L'«Esito atteso» è una **griglia di verifica per il giudizio umano**, non un test
  automatico: dice cosa il modello DEVE segnalare, cosa PUÒ segnalare e — soprattutto —
  cosa NON DEVE toccare. Il runner blocca solo le regressioni meccaniche: il verdetto
  finale è umano.

## Regole di manutenzione (vincolanti)

- **Rieseguire l'intero set a ogni modifica** di Style Bible, few-shot, prompt o
  modello (`npm run golden` in `functions/`). Una regressione di stile è un bug a
  tutti gli effetti.
- Quando si aggiunge o modifica un brano, aggiornare la sua voce in `checks.json`
  (citazioni verbatim: il runner verifica l'allineamento, anche con `--dry`).
- I brani sono fittizi: in sviluppo si possono usare anche sul tier free di Gemini.
  I brani **veri** del libro invece passano SOLO dal tier a pagamento.
- Il set cresce: quando un brano vero fa emergere un difetto nuovo, si aggiunge qui un
  brano fittizio che riproduce quel difetto, con il suo esito atteso.
