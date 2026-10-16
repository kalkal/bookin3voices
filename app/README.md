# bookin3voice — app mobile

App Expo (React Native + TypeScript) di bookin3voice. Vive in `app/`; le Cloud
Functions sono in `functions/`, accanto a questa cartella.

## Comandi

Requires Node 20+ (24 recommended) on your PATH.

| Comando                    | Cosa fa                                  |
| -------------------------- | ---------------------------------------- |
| `npm start`                | Avvia Expo (dev server)                  |
| `npm test`                 | Jest + jest-expo                         |
| `npm run typecheck`        | `tsc --noEmit` (strict)                  |
| `npm run lint`             | ESLint (flat config Expo + Prettier)     |
| `npm run format`           | Prettier su tutto il progetto            |
| `npm run test:integration` | Test contro gli emulatori Firebase       |
| `npm run emulators`        | Avvia l'Emulator Suite (Windows)         |
| `npm run e2e:android`      | Flussi Maestro (vedi `../e2e/README.md`) |

## Struttura (feature folders)

```
app/
  App.tsx              entry UI
  src/
    features/
      dictation/       dettatura (engine, state machine, schermate)
      review/          suggerimenti AI e revisione
      export/          export EPUB/DOCX
    lib/               utility pure condivise (unit-testate)
  __tests__/           test di componenti top-level
```

Regole: componenti mai a contatto con l'SDK Firebase (Repository pattern),
logica pura in `src/lib` o nelle feature, test accanto al codice in `__tests__/`.

## Pre-commit (Husky + lint-staged)

`npm install` (script `prepare`) imposta `core.hooksPath = app/.husky/_` nella
config locale del repo. Il pre-commit esegue lint-staged (ESLint + Prettier +
Jest sui file toccati) e il typecheck completo.
