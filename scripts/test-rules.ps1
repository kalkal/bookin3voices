# Firestore security rules tests on an ephemeral emulator.
# Starts ONLY the Firestore emulator with `emulators:exec` and runs the Jest
# suite in rules-tests/. Same prerequisites (Node 24 + global firebase-tools,
# JRE 21) and same Java workaround as start-emulators.ps1 — see there
# for the explanation of JAVA_TOOL_OPTIONS.

$tools = $env:BOOKVOICE_TOOLS  # optional: folder with portable Node 24 + JRE 21; unset = use PATH
if ($tools) {
  $env:PATH = "$tools\node-v24.20.0-win-x64;$tools\jdk-21.0.12.1+1-jre\bin;$env:PATH"
  $env:JAVA_HOME = "$tools\jdk-21.0.12.1+1-jre"
}
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\nonexistent-bookvoice-path'

Set-Location (Join-Path $PSScriptRoot '..')
firebase emulators:exec --only firestore "npm --prefix rules-tests run test:jest"
exit $LASTEXITCODE
