# App assets

- `icon-source.svg`: the full app icon (arch, "in", the slanted line with its diamond, and the "3" with its spike), 160x160 viewBox, letters already converted to outlines (UnifrakturCook Bold, SIL OFL, see `../../licenses/`). It is the source of `icon.png` (1024, square, solid #121012: the stores round the corners) and of the Android layers: `android-icon-foreground.png` (the artwork scaled to 58% so every opaque pixel lies inside the 66 dp safe circle, radius 313 px of 1024; transparent), `android-icon-background.png` (solid #121012) and `android-icon-monochrome.png` (single colour, transparent).
- `icon-small-source.svg`: only the "3" with its spike, bigger and with a wider spike root so it still reads at 16-48 px. It is the source of `favicon.png` (48).
- `splash-source.svg` and `splash-icon.png`: the native splash (shown by the system before the app starts): the full mark on transparency, 1024 square, drawn by the `expo-splash-screen` plugin at 188 dp wide on #121012 (the app's own opening screen draws the same mark at about the same size, so the hand-over is not noticeable). The test checks that the mark stays inside the 96 dp circle that Android 12 masks it with.
- `ornaments/`: line drawings used inside the app (cathedral backgrounds, the eye).

The PNGs are plain renders of the SVGs (any SVG renderer; Edge in headless mode was used). `__tests__/brandAssets.test.ts` pins their size and transparency.
