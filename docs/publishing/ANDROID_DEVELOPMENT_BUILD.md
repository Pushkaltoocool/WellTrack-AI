# Android development build

This is an installable Android APK with Expo's development tools. It loads WellTrack from a development server running on your computer. Keep that server running while using the app.

EAS project: https://expo.dev/accounts/pushkaltoocool/projects/welltrack-ai

Android development build completed successfully on November 2, 2026: [build details and installation QR code](https://expo.dev/accounts/pushkaltoocool/projects/welltrack-ai/builds/29ea221e-bb06-4c29-af4c-40e4f7b08cea).

[Download the Android development APK](https://expo.dev/artifacts/eas/kiMmeu-T9HDwoEHxk1uXAdy9UuhsaT2i0Lmg6vjv-q8.apk).

Validation passed: Expo lint, TypeScript typecheck, all 20 Expo Doctor checks, Android JavaScript export, and the EAS Android native build. Installation and runtime behavior on your physical phone still need to be checked.

## Install on your Android phone

1. Open the completed Android development build in the EAS project above, then tap **Install**. You can also scan its installation QR code with your phone.
2. Download the APK on your phone and open the downloaded file.
3. If Android asks, allow **Install unknown apps** for the browser or file manager you used, then tap **Install**. You can turn that permission off again after installation.
4. Look for **WellTrack AI** on your phone. You do not need Expo Go for this build.

## Load the app

On your computer, open PowerShell in the project folder and run:

```powershell
Set-Location C:\Users\USER\Documents\GitHub\WellTrack-AI
npx expo start --dev-client --lan
```

Connect the phone and computer to the same Wi-Fi. Open **WellTrack AI** and select the detected development server, or scan the terminal's QR code with the phone's camera/QR reader and open the WellTrack link.

If the server cannot be reached, allow Node.js through Windows Firewall on your private network. Campus, guest, or isolated Wi-Fi may block local connections; in that case stop the server with Ctrl+C and run:

```powershell
npx expo start --dev-client --tunnel
```

If Expo asks to install its tunnel helper, accept the prompt. Both devices need internet for a tunnel. Keep your computer awake and the server running. A launcher asking for a server is expected until you connect it.

## Rebuild

JavaScript and styling changes load from the server without a new APK. After adding native libraries or changing native configuration, run:

```powershell
npx eas-cli@latest build --profile development --platform android
```

Install the resulting APK over the previous development build. If Android reports a signing conflict, export any journal data before uninstalling the old app; uninstalling removes local data.

If packaging stalls while cloning this repository's large training-data history, upload the current working files using the existing `.easignore` rules:

```powershell
$env:EAS_NO_VCS = '1'
$env:EAS_PROJECT_ROOT = (Get-Location).Path
try {
  npx eas-cli@latest build --profile development --platform android
} finally {
  Remove-Item Env:EAS_NO_VCS
  Remove-Item Env:EAS_PROJECT_ROOT
}
```

## Configuration and testing

- `.env.local` supplies configuration to the local development server. EAS uses the project's **development** environment for cloud builds. Environment files and Firebase admin credentials are excluded from uploads.
- This development environment may use a direct OpenRouter key for private coach testing. Public environment variables are included in the client bundle; use the backend proxy for a shared release.
- Test onboarding, tracking, check-ins, app lock, notification permission and reminders on the phone.
- Google sign-in additionally requires an Android OAuth client for `com.welltrackai.app` and the signing certificate SHA-1 in Firebase/Google Cloud. An installed APK alone does not complete that account setup. Email/password and local-only use remain available when configured.
- Android all-day health history still requires a Health Connect implementation; a development build alone does not add it.
- iOS builds are deferred until the week of November 9, 2026.

Official references: [install an APK](https://docs.expo.dev/build-reference/apk/) and [use a development build](https://docs.expo.dev/develop/development-builds/use-development-builds/).
