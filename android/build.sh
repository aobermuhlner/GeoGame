#!/usr/bin/env bash
# Builds the signed release bundle (app-release-bundle.aab, for Play) and APK (app-release-signed.apk, for
# installing on a device) with Bubblewrap. See README.md for the one-time setup.
#
# The upload key lives outside the repo: $ANDROID_KEYS/geogame-upload.jks with its password in
# $ANDROID_KEYS/geogame-upload.password (default ANDROID_KEYS=~/.android-keys). Bubblewrap prints the
# password when signing fails, so all output is masked.
set -euo pipefail
cd "$(dirname "$0")"

KEYS="${ANDROID_KEYS:-$HOME/.android-keys}"
BW_HOME="${BUBBLEWRAP_HOME:-$HOME/.bubblewrap}"
PW="$(cat "$KEYS/geogame-upload.password")"

# jarsigner/keytool come from the JDK that Bubblewrap is configured with (~/.bubblewrap/config.json).
CONFIG="$BW_HOME/config.json"
JDK="$(node -p "require(process.argv[1]).jdkPath" "$(cygpath -w "$CONFIG" 2>/dev/null || echo "$CONFIG")")"
export PATH="$(cygpath -u "$JDK" 2>/dev/null || echo "$JDK")/bin:$PATH"
# Bubblewrap runs `gradlew.bat` from the current directory, which this setting would block.
unset NoDefaultCurrentDirectoryInExePath

BUBBLEWRAP_KEYSTORE_PASSWORD="$PW" BUBBLEWRAP_KEY_PASSWORD="$PW" \
  "$BW_HOME/cli/node_modules/.bin/bubblewrap" build --skipPwaValidation "$@" 2>&1 | sed "s/$PW/***/g"
