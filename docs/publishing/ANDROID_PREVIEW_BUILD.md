# Standalone Android preview

The preview APK bundles WellTrack inside the app. It opens directly without Expo Go, a development server, a computer, or a shared Wi-Fi network.

Build completed successfully November 3, 2026: [Android preview, version 1.0.0 (2)](https://expo.dev/accounts/pushkaltoocool/projects/welltrack-ai/builds/8a796636-6873-4eb0-980c-e47769c02a36).

**[Download the standalone Android preview APK](https://expo.dev/artifacts/eas/vUllkAioDgHZD1WwiOyY86vm2Um2Fek3EBzD9SL96ho.apk).**

Expo lint, TypeScript typecheck, all 20 Expo Doctor checks, local release bundle export, and the EAS Android release build passed. Physical-device installation and runtime testing remain to be checked.

The downloaded APK was inspected: its app bundle is embedded, Firebase configuration is included, and the private development API key is absent. Download size: approximately 124 MB.

## Install

1. Open the completed build page on your Android phone and tap **Install**, or scan its installation QR code.
2. Download and open the APK. If prompted, allow **Install unknown apps** for the browser or file manager, then tap **Install**.
3. Open **WellTrack AI** from your phone's app list. No terminal command or server connection is required.

The preview uses the existing `com.welltrackai.app` package and EAS signing credentials. Try installing it as an update over the development build. If Android reports a signing conflict, export your journal data before uninstalling the old app, because uninstalling deletes local data.

Local journaling and tracking can run offline. Accounts and cloud backup need internet. The AI coach is hidden in this preview because no AI proxy is configured; the private development OpenRouter key is excluded. Google sign-in still requires the Firebase/Google Android OAuth setup described in the release checklist.

## Rebuild

```powershell
Set-Location C:\Users\USER\Documents\GitHub\WellTrack-AI
$env:EAS_NO_VCS = '1'
$env:EAS_PROJECT_ROOT = (Get-Location).Path
$env:EXPO_NO_DOTENV = '1'
try {
  npx eas-cli@latest build --profile preview --platform android
} finally {
  Remove-Item Env:EAS_NO_VCS
  Remove-Item Env:EAS_PROJECT_ROOT
  Remove-Item Env:EXPO_NO_DOTENV
}
```

The preview profile uses Node 24.14.1, an embedded release bundle, internal APK distribution, and automatic Android version-code increments. Configuration comes from the EAS **preview** environment. Local environment files, admin credentials, and training data are excluded from the upload. `EXPO_NO_DOTENV` prevents development-only local environment files from being loaded for this profile.

iOS remains deferred until the week of November 9, 2026.

Reference: [Expo preview builds](https://docs.expo.dev/build/eas-json/#preview-builds).
