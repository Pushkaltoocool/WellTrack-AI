# Release checklist

Status as of 2026-10-31. Items marked **[you]** need your accounts, a decision or a paid plan. Everything else is done in the repo.

## 0. Before anything else (5 minutes) [you]

1. **Deploy Firestore security rules.** Until you do, cloud backup is refused (the database is in locked mode).
   ```bash
   python -I scripts/deploy_firestore_rules.py welltrackai-128b4-firebase-adminsdk-fbsvc-6c75efe737.json
   # or, with firebase-tools: npx firebase-tools deploy --only firestore:rules
   ```
2. **Move the service-account key out of the repo folder** (it grants full admin access to the project), and consider rotating it in Google Cloud Console → IAM → Service accounts. It's git-ignored, but the safest place is outside the project.
3. **Rotate the OpenRouter key** before release. It was shared in chat and is in `.env.local` (git-ignored, but inlined into dev bundles).
4. Delete the QA test account created during testing: Firebase Console → Authentication → `qa+1793381309@example.com`.

## 1. Decisions [you]

- [ ] **Bundle ID / package:** `com.welltrackai.app` is a placeholder in `app.json`. It can't be changed after the first store submission.
- [ ] **Support email**, to fill in `docs/legal/*.md`, then run `python -I scripts/build_legal_pages.py`.
- [ ] **AI coach in production:** the free OpenRouter key allows 50 requests per day, shared by all users. Either:
  - (a) upgrade Firebase to Blaze, deploy `functions/` (the proxy, 30 requests per user per day), add OpenRouter credits ($10 raises free-model limits), and set `EXPO_PUBLIC_AI_PROXY_URL`; or
  - (b) ship 1.0 with the coach hidden: leave both `EXPO_PUBLIC_OPENROUTER_API_KEY` and `EXPO_PUBLIC_AI_PROXY_URL` empty in the production environment. `AI_ENABLED` turns false and every coach entry point disappears.
  - **Never ship a production build with `EXPO_PUBLIC_OPENROUTER_API_KEY` set.** Anyone could extract it from the bundle.

## 2. Hosting (privacy policy and support page) [you]

```bash
python -I scripts/build_legal_pages.py
npx firebase-tools login
npx firebase-tools deploy --only hosting      # → https://welltrackai-128b4.web.app
```

## 3. Development builds

The Android development build completed successfully on 2026-11-02: `expo-dev-client` is installed, the EAS project is linked, and development environment variables are uploaded. See [APK download, installation and development instructions](ANDROID_DEVELOPMENT_BUILD.md). The [standalone Android preview](ANDROID_PREVIEW_BUILD.md), version 1.0.0 (2), completed on 2026-11-03 and runs without a computer or development server. The preview environment includes Firebase config and excludes the private development OpenRouter key; the coach is hidden until an AI proxy is configured. iOS is deferred until the week of November 9, once the Apple account is active.

1. `npx expo install expo-dev-client`. After this, `npx expo start` targets the dev build; use `--go` to keep using Expo Go.
2. `npx eas-cli@latest login`, then `npx eas-cli@latest init` (adds `extra.eas.projectId`).
3. EAS environment variables (`.env.local` is not uploaded): `npx eas-cli@latest env:create` for each `EXPO_PUBLIC_*` value, per environment (development / preview / production).
4. `npx eas-cli@latest build --profile development --platform ios` (and `android`).
5. Things to verify in the dev build (they can't run in Expo Go):
   - Face ID app lock (Expo Go doesn't support Face ID).
   - Custom Android notification channel. Expo Go rejected channel creation, so reminders currently fall back to the default channel.

## 4. Sign in with Google and Apple (dev build) [you]

Apple guideline 4.8: if Google sign-in is offered on iOS, Sign in with Apple must be offered too. Both are implemented in `src/services/firebase/auth.ts` and appear automatically outside Expo Go.

1. Firebase Console → Project settings → add an **iOS app** (bundle `com.welltrackai.app`) and an **Android app** (same package, plus the SHA-1 from `eas credentials`).
2. **Google:**
   - Put the iOS client's reversed ID in `app.json` plugins:
     ```json
     ["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<IOS_CLIENT_ID>" }]
     ```
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is already set to the web client ID from Firebase.
3. **Apple:** Apple Developer → Identifiers → enable *Sign in with Apple* for the App ID. Firebase Console → Authentication → enable **Apple**. `app.json` already has `ios.usesAppleSignIn: true` and the plugin.

## 5. Store submission

- [ ] App Store Connect: create the app, then fill in `docs/publishing/STORE_LISTING.md` and `PRIVACY_LABELS.md`. Age rating 12+. Add a review demo account.
- [ ] Screenshots (6.7" iPhone, Android phone), shot with a fictional test account.
- [ ] `npx eas-cli@latest build --profile production --platform all`
- [ ] `npx eas-cli@latest submit --platform ios` / `--platform android`
- [ ] Play Console: Data safety form, health apps declaration, account-deletion URL, content rating questionnaire.

## 6. Already done in code

- Accounts (email/password; Google and Apple ready for the dev build), email verification, password reset.
- Cloud backup and restore with conflict handling.
- In-app account deletion: auth user plus Firestore data, with re-authentication.
- Local JSON export and restore. App lock. Local reminders.
- iOS privacy manifest reasons, `ITSAppUsesNonExemptEncryption: false`, permission strings for Motion, Face ID and notifications.
- AI consent screen, provenance tags, crisis keyword handling, prompt-injection guard.
- Firestore rules (owner-only; deny everything else).
- `eas.json` profiles.
