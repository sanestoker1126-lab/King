#!/usr/bin/env bash
# Compila el APK de Android (android/) con el juego actual. Uso, desde legend-of-presos/:
#   ANDROID_HOME=/ruta/al/sdk tools/build_android.sh
# Requisitos: Java 17+, Gradle 8.9+ (o el de Android Studio) y el SDK de Android con "platforms;android-35" y
# "build-tools;35.0.0". El SDK se instala con:  sdkmanager "platforms;android-35" "build-tools;35.0.0"
# Sale en: android/app/build/outputs/apk/release/app-release.apk (firmado con la llave de PRUEBA android/firma-prueba.keystore)
set -euo pipefail
cd "$(dirname "$0")/../android"
: "${ANDROID_HOME:?Define ANDROID_HOME con la ruta del SDK de Android}"
echo "sdk.dir=$ANDROID_HOME" > local.properties
GRADLE="${GRADLE:-$(command -v gradle || echo /opt/gradle/bin/gradle)}"
"$GRADLE" --no-daemon -q assembleRelease
APK=app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME"/build-tools/35.0.0/apksigner verify "$APK"
ls -la "$APK"; sha256sum "$APK"
