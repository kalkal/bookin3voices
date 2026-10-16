# Third-party licenses

Checked in October 2026 with `license-checker-rseidelsohn --production --summary` in `app/` and
`functions/`. Every runtime dependency is under a license compatible with distributing this
project under MIT. Regenerate the list before each release.

| Package | License | Note |
| --- | --- | --- |
| most packages | MIT, Apache-2.0, ISC, BSD-2/3-Clause, 0BSD, BlueOak-1.0.0, Unlicense, Python-2.0 | permissive |
| `@expo-google-fonts/cormorant-garamond`, `@expo-google-fonts/eb-garamond` | MIT AND OFL-1.1 | fonts bundled in the app; the SIL Open Font License travels with them, fonts must not be sold on their own |
| `lightningcss` (build tooling) | MPL-2.0 | file-level copyleft, used unmodified, not part of the shipped code |
| `caniuse-lite` (build tooling) | CC-BY-4.0 | data, attribution to the caniuse project |
| `node-forge` | BSD-3-Clause OR GPL-2.0 | used under BSD-3-Clause |
| `jszip` | MIT OR GPL-3.0-or-later | used under MIT |
| `pako` | MIT AND Zlib | permissive |
| `@aws-sdk/*` | Apache-2.0 | Amazon Bedrock client |

No GPL/AGPL-only, SSPL or "non-commercial" license was found among the dependencies.
