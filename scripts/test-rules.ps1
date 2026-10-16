# Test delle security rules Firestore su emulatore effimero.
# Avvia il SOLO emulatore Firestore con `emulators:exec` ed esegue la suite
# Jest di rules-tests/. Stessi prerequisiti (Node 24 + firebase-tools globale,
# JRE 21) e stesso workaround Java di start-emulators.ps1 — vedi lì
# per la spiegazione di JAVA_TOOL_OPTIONS.

$tools = $env:BOOKVOICE_TOOLS  # optional: folder with portable Node 24 + JRE 21; unset = use PATH
if ($tools) {
  $env:PATH = "$tools\node-v24.20.0-win-x64;$tools\jdk-21.0.12.1+1-jre\bin;$env:PATH"
  $env:JAVA_HOME = "$tools\jdk-21.0.12.1+1-jre"
}
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\percorso-inesistente-bookvoice'

Set-Location (Join-Path $PSScriptRoot '..')
firebase emulators:exec --only firestore "npm --prefix rules-tests run test:jest"
exit $LASTEXITCODE
