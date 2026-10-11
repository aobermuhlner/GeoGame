# Android app (Trusted Web Activity)

The Android app is a thin [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity)
generated with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). It opens the live site
(`https://georivals.pages.dev/?source=twa`) full screen in Chrome. There is no app code of its own: deploying the
website updates the app. The site detects the app with `isApp` (`frontend/src/platform.ts`).

| | |
|---|---|
| Package id | `com.aobermuhlner.geogame` (**can never change**) |
| Config | [`twa-manifest.json`](twa-manifest.json) → generates the Gradle project (`app/`, `build.gradle`) |
| Asset links | [`frontend/public/.well-known/assetlinks.json`](../frontend/public/.well-known/assetlinks.json) |
| Min / target SDK | 24 (Android 7.0) / 36 (Android 16) |

Edit `twa-manifest.json`, not the generated Gradle files, then run `bubblewrap update` (below) to regenerate them.

## One-time setup (per machine)

1. **Tools**, all under `~/.bubblewrap` (nothing system-wide):
   - JDK 17 (Eclipse Temurin) in `~/.bubblewrap/jdk/`
   - Android SDK in `~/.bubblewrap/android_sdk/`: command-line tools in `cmdline-tools/latest/`, plus
     `platform-tools`, `platforms/android-36` and `build-tools/36.1.0` (the version Bubblewrap 1.27 requires).
     Bubblewrap checks for a `bin/` folder at the SDK root; on this layout that is a junction to
     `cmdline-tools/latest/bin`.
   - Bubblewrap CLI: `npm install --prefix ~/.bubblewrap/cli @bubblewrap/cli@1.27.0`
   - `~/.bubblewrap/config.json`: `{ "jdkPath": "<…>/jdk/jdk-17…", "androidSdkPath": "<…>/android_sdk" }`
2. **Upload key**, outside the repo in `~/.android-keys/`:
   - `geogame-upload.jks` (PKCS12, alias `upload`) and `geogame-upload.password` (store and key password).
   - **Back this folder up.** Losing it means asking Play support for an upload-key reset.
   - Never commit or print it. `.gitignore` blocks `*.jks`, `*.keystore` and `*.password`.

The upload key's SHA-256 fingerprint (public) is
`3D:83:E0:F7:32:32:4E:65:64:4B:77:84:64:65:94:2A:82:D5:FB:1E:A8:C2:D2:D9:22:72:D6:9F:B8:3D:32:D4`.

## Build

```bash
bash android/build.sh
```

Output in `android/` (not committed):
- `app-release-bundle.aab`: upload this to Play.
- `app-release-signed.apk`: install on a phone or emulator (`adb install -r android/app-release-signed.apk`).

`build.sh` passes the password through environment variables and masks it in the output (Bubblewrap prints it
when signing fails).

## Release a new version

Only needed when the app itself changes (name, icon, colours, start URL, Android settings). Website changes reach
the app without a release.

1. Bump the version and regenerate the project:
   ```bash
   cd android && ~/.bubblewrap/cli/node_modules/.bin/bubblewrap update --appVersionName=1.0.1
   ```
   This raises `appVersionCode` by one; Play rejects a bundle whose version code it has seen before.
2. `bash android/build.sh`
3. Play Console → the app → **Test and release** → a track (internal testing first) → **Create new release** →
   upload `app-release-bundle.aab`.
4. Commit `twa-manifest.json` and the regenerated files.

## Asset links (hides the browser bar)

Chrome only shows the app without an address bar when
`https://georivals.pages.dev/.well-known/assetlinks.json` lists the certificate fingerprint of the APK on the
phone:
- the **upload key** (above): for APKs installed by hand, e.g. `app-release-signed.apk`;
- the **Play App Signing key**: for installs from Play. Google re-signs uploads with it. Find it in Play Console →
  the app → **Test and release → Setup → App signing** → "App signing key certificate" → SHA-256, and add it to
  `sha256_cert_fingerprints`.

The file is deployed with the website. If the browser bar shows in the app, check the file is reachable and that
the fingerprint matches (`adb shell pm get-app-links com.aobermuhlner.geogame`).

## Changing the website address

The host is fixed in `twa-manifest.json` (`host`, `iconUrl`, `webManifestUrl`, `fullScopeUrl`). Moving the site:
update those, `bubblewrap update`, rebuild, release, and serve `assetlinks.json` on the new host. See the
Deploy section of the main README for the Worker and Google sign-in side.
