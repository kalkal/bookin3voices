# E2E con Maestro

Flussi end-to-end su emulatore Android con [Maestro](https://maestro.mobile.dev):
YAML in `flows/`, testID definiti dalle schermate.

## Come funziona la modalità E2E

Sull'emulatore lo speech-to-text reale non è praticabile, quindi i flussi girano
con l'app in **modalità E2E**: Metro avviato con `EXPO_PUBLIC_E2E=1` fa usare a
`App.tsx` il `FakeDictationEngine` pilotato da uno script a tempo, un pre-flight
sempre verde e servizi tutti in memoria (niente Firebase né AsyncStorage). Vedi
`app/src/dev/e2eDictation.ts` e il blocco E2E di `app/App.tsx`, che semina:

- il capitolo della dettatura **vuoto** (il flusso verifica proprio quel percorso);
- un capitolo «La tazza» già scritto per la review, col testo che fa scattare
  due regole del `FakeSuggestionsProvider`;
- 2 suggerimenti pending fissi per l'avviso della tab Export; l'export usa
  `InMemoryBookExportService` (file finto, niente Emulator Suite né share
  sheet — l'EPUB vero è coperto dai test Jest della feature Export sul Firebase Emulator).

L'app di uso normale non passa mai di lì: senza la variabile il bundle usa il
motore nativo e i servizi Firebase. Ogni flusso riparte da processo fresco
(`stopApp` nel preambolo comune `helpers/open-e2e-app.yaml`), quindi lo stato
in memoria non trapela da un flusso all'altro.

## Prerequisiti (una tantum)

- **Android SDK + emulatore** (un AVD qualsiasi, es. API 36 Google APIs x86_64).
- **Maestro CLI** (richiede Java).
- **Dev client installato**: build EAS `development` (APK), poi
  `adb install <apk>`. La build si rifà solo quando cambia la parte nativa.

Gli script cercano SDK e Maestro in una cartella `tools` accanto al repo (o in quella
indicata da `BOOKVOICE_TOOLS`); per percorsi diversi (es. CI) usare le variabili
d'ambiente `ANDROID_SDK_ROOT` e `MAESTRO_BIN`.

## Lanciare il flusso

```powershell
# 1. avviare l'emulatore Android (finestra), ad esempio:
emulator -avd <nome-avd>

# 2. dalla cartella app/:
npm run e2e:android
```

Lo script `run-android.mjs` verifica emulatore e dev client, fa
`adb reverse tcp:8081`, avvia Metro con `EXPO_PUBLIC_E2E=1`, esegue
`maestro test` su **tutta la cartella `flows/`** (in sequenza alfabetica) e
spegne tutto. Un flusso specifico: `npm run e2e:android -- ..\e2e\flows\<nome>.yaml`.

## Flussi

| Flusso | Percorso coperto |
|---|---|
| `flows/dictation-fake.yaml` | apri dettatura → detta (Fake) → pausa → testo + contatore + salvataggio |
| `flows/export-epub.yaml` | Libro → tab Export → avviso «2 suggerimenti in sospeso» → Genera EPUB → esito «generato» |
| `flows/review-accept.yaml` | Libro → capitolo seminato → Rifinisci con AI → accetta variante B (stile), rifiuta grammatica → testo aggiornato, pending a zero |

Il preambolo comune (deep link, developer menu, `stopApp`) è in
`helpers/open-e2e-app.yaml`, richiamato dai flussi con `runFlow`.
