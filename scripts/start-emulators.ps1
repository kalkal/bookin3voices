# Avvia la Firebase Emulator Suite (Auth, Firestore, Functions, Storage + UI su :4000).
# Prerequisiti (optional portable toolchain via BOOKVOICE_TOOLS):
#  - Node v24 (node-v24.20.0-win-x64) con firebase-tools installato globalmente
#  - JRE 21 (jdk-21.0.12.1+1-jre): firebase-tools >= 14 richiede Java 21+
#
# NOTA JAVA_TOOL_OPTIONS: su alcune macchine Windows i socket AF_UNIX sono bloccati (connect
# fallisce con EINVAL) e il pipe interno dei Selector NIO di JDK 16+ li usa per
# default. Puntando jdk.net.unixdomain.tmpdir a un percorso inesistente il JDK
# ripiega sul pipe TCP loopback, che funziona. Senza questa variabile
# l'emulatore Firestore muore all'avvio con "Unable to establish loopback connection".

$tools = $env:BOOKVOICE_TOOLS  # optional: folder with portable Node 24 + JRE 21; unset = use PATH
if ($tools) {
  $env:PATH = "$tools\node-v24.20.0-win-x64;$tools\jdk-21.0.12.1+1-jre\bin;$env:PATH"
  $env:JAVA_HOME = "$tools\jdk-21.0.12.1+1-jre"
}
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\percorso-inesistente-bookvoice'

# Progetto: the project id in .firebaserc — gli emulatori restano comunque
# locali al 100% (nessuna chiamata al progetto reale; regola d'oro).
Set-Location (Join-Path $PSScriptRoot '..')

# L'emulatore functions serve il compilato in lib/: build prima di partire
# (senza, exportBook e le altre callable restano alla versione vecchia).
npm --prefix functions run build

firebase emulators:start
