# Starts the Firebase Emulator Suite (Auth, Firestore, Functions, Storage + UI on :4000).
# Prerequisites (optional portable toolchain via BOOKVOICE_TOOLS):
#  - Node v24 (node-v24.20.0-win-x64) with firebase-tools installed globally
#  - JRE 21 (jdk-21.0.12.1+1-jre): firebase-tools >= 14 requires Java 21+
#
# NOTE on JAVA_TOOL_OPTIONS: on some Windows machines AF_UNIX sockets are blocked
# (connect fails with EINVAL) and the internal pipe of JDK 16+ NIO Selectors uses
# them by default. Pointing jdk.net.unixdomain.tmpdir to a nonexistent path makes
# the JDK fall back to the TCP loopback pipe, which works. Without this variable
# the Firestore emulator dies at startup with "Unable to establish loopback connection".

$tools = $env:BOOKVOICE_TOOLS  # optional: folder with portable Node 24 + JRE 21; unset = use PATH
if ($tools) {
  $env:PATH = "$tools\node-v24.20.0-win-x64;$tools\jdk-21.0.12.1+1-jre\bin;$env:PATH"
  $env:JAVA_HOME = "$tools\jdk-21.0.12.1+1-jre"
}
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\nonexistent-bookvoice-path'

# Project: the project id in .firebaserc — the emulators remain 100% local
# anyway (no call to the real project; golden rule).
Set-Location (Join-Path $PSScriptRoot '..')

# The functions emulator serves the compiled output in lib/: build before starting
# (without it, exportBook and the other callables stay on the old version).
npm --prefix functions run build

firebase emulators:start
