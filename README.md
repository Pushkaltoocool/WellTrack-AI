# WellTrack AI

**Your personal AI-powered student wellness companion.**
Monitor → Understand → Predict → Recommend → Improve.

WellTrack AI is a React Native / Expo app that combines on-device human-activity recognition (HAR) from the phone's motion sensors, a daily wellness check-in, insights and a personal stress model learned from your own entries, transparent rule-based suggestions, goals, an exam planner, reminders and an optional AI coach. The journal lives on the device. An account is optional and only adds a private cloud backup. There's no ads, analytics or tracking SDK.

> WellTrack AI is a wellness tool, **not a medical device**. It does not diagnose, treat or prevent any condition.

| | |
|---|---|
| Expo SDK | 58 (React Native 0.88, React 19.3), **Expo Go compatible**: native-only features (Google sign-in, Face ID) are guarded and appear in dev/store builds |
| Language | TypeScript (strict) |
| Navigation | Expo Router (`src/app`) |
| Storage | `expo-sqlite`, versioned schema (v3); optional Firebase Auth + Firestore backup |
| AI coach | OpenRouter (free models) via a dev key or the `functions/` proxy for release |
| Sensors | `expo-sensors`: accelerometer, gyroscope, pedometer (foreground only) |
| ML | Python + scikit-learn training; pure-TypeScript inference from exported JSON |

## Features

- **Onboarding**: explains capabilities, limitations, sensors and privacy. Optional name and starting goals. No registration.
- **Home dashboard**: current recognised activity, active and sedentary minutes, pedometer steps (only during tracked sessions), sleep from the check-in, check-in summary, experimental stress estimate, activity breakdown, suggestions and today's goals. Every number carries a provenance tag (*Sensor-measured*, *ML prediction*, *Self-reported*, *Rule-based*, *Recorded demo data*, *Experimental*, *Unavailable*).
- **Live activity tracking**: real accelerometer and gyroscope subscriptions, timestamp-based resampling to 50 Hz, 2.56 s windows with 50 % overlap, 82 features, multinomial logistic regression. The screen shows six classes, the softmax probability with its caveat, live XYZ charts, sensor health, a placement/orientation check, and session history.
- **Recorded replay mode**: replays real held-out UCI HAR test-subject recordings through the *same* pipeline. It works on the emulator and shows the recorded label next to each prediction. Replay sessions are stored separately and never count toward personal stats.
- **Daily check-in**: sleep, study, screen time, physical activity, social and extracurricular time, academic pressure, stress, mood and notes. Inputs are validated and today's or past entries can be edited.
- **Wellness & stress**: a self-reported summary plus an experimental decision-tree estimate. The screen shows the inputs used, the decision path and the limitations. No confidence is shown (see the ML report for why).
- **Wellness support**: a deterministic suggestion engine with evidence from your own data. Suggestions can become goals, be marked done or be dismissed, and past suggestions stay visible. Includes a focus/break timer, box breathing and a student-support page.
- **Trends**: 7- and 30-day views of activity per class, active minutes, sleep, study, stress and mood, goal completion, estimate history and check-in history.
- **All-day steps (iPhone)**: opt-in. Reads daily totals for the last 7 days from Core Motion and keeps them in SQLite, so history grows past iOS's 7-day window. Not available on Android in Expo Go (it needs Health Connect and a development build).
- **Evening design**: midnight surfaces, cream text, bundled Figtree and Fraunces fonts, and the reference owl. Floating Today / Journey / Settings navigation keeps tracking and support close to Today. Check-ins use six guided steps; detailed charts and sensor diagnostics remain available on demand. Breathing honors reduced motion; break and focus timers use wall-clock deadlines.
- **Accounts (optional)**: email/password with verification and password reset; Google and Sign in with Apple in store/dev builds. Automatic, debounced backup to Firestore; restore on a new phone; conflict prompt on first sign-in; in-app account deletion.
- **Wren, the AI coach (optional)**: explicit consent screen, a compact summary of your last 14 days (notes only if you opt in), crisis-phrase detection with an always-local emergency card, and an *AI-generated* tag on every reply.
- **Insights**: weekly recap, patterns in your own days (with sample sizes, never causal claims), and a personal stress model trained on-device that is only shown when it beats your average by at least 20 % in leave-one-out testing.
- **Exams & deadlines**: countdowns on Today, exam-week suggestions and an evening-before reminder.
- **Reminders and privacy**: local reminders (check-in, wind-down, exams), app lock with biometrics or the device passcode, export and restore from a JSON file.
- **Settings & diagnostics**: profile, goals, smoothing toggle, sensor availability, full model metadata and comparison, privacy, JSON export, delete-all, and diagnostics (SDK, runtime, schema version, row counts, active sensor subscriptions).

## Quick start

To install WellTrack on Android and use it without a computer or development server, follow the [standalone Android preview guide](docs/publishing/ANDROID_PREVIEW_BUILD.md).

Requirements: Node 24.12+ (tested with Node 24.14), npm, and Expo Go **58.x** on an Android phone or emulator. For the Android development build, follow [the installation guide](docs/publishing/ANDROID_DEVELOPMENT_BUILD.md).

```bash
npm install
cp .env.example .env.local    # fill in Firebase web config; OpenRouter key for local coach testing only
npx expo start --go --lan
```

Without `.env.local` the app still runs fully offline: account and coach entry points hide themselves.

Scan the QR code with **Expo Go** (Android: in-app scanner) while the phone is on the same network. If your network blocks device-to-device traffic (common on campus Wi-Fi), use `npx expo start --go --tunnel`. `npm start` now targets the installed development build by default.

### Android emulator

1. Start an AVD from Android Studio, or run `emulator -avd <name>`.
2. Install Expo Go 58. Pressing `a` in the Expo CLI installs the right version, or download the APK listed at `https://api.expo.dev/v2/versions/latest` (`sdkVersions["58.0.0"].androidClientUrl`) and run `adb install`.
3. `adb reverse tcp:8081 tcp:8081`, then `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent`.

The emulator's virtual sensors are mostly static, so use **Activity → Recorded replay** to demonstrate the classifier.

### Development commands

| Command | Purpose |
|---|---|
| `npm start` | Expo dev server |
| `npm test` | Jest: parity tests, windowing, engine, recommendations, validation, aggregation |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (`eslint-config-expo`, React Compiler rules) |
| `npx expo-doctor` | Dependency and config diagnostics |
| `npm run train:har` | Re-train and evaluate the HAR models; regenerate model JSON, parity fixtures and replay data |
| `npm run train:stress` | Re-train the stress-risk experiment |

Python 3.11+ with `numpy pandas scikit-learn matplotlib` is needed only for training. The app never calls Python.

## Project layout

```
src/app/                 Expo Router routes: (tabs)/home, activity, wellness, trends, settings;
                         onboarding, checkin, stress, focus, breathing, support
src/components/          design system (ui/), SVG charts (charts/), wellness cards
src/features/activity/   tracking engine, TrackerProvider (sensor lifecycle), replay, orientation check
src/features/wellness/   check-in validation, recommendation engine, write orchestration
src/features/analytics/  pure aggregation helpers
src/services/sensors/    timestamp-based resampler / windower
src/services/ml/         feature extraction (TS port), generic inference, model loaders
src/services/database/   schema + migrations, repositories, DataProvider / useDbQuery
src/theme/, src/types/   design tokens, shared domain types
models/                  exported model JSON (har_model.json, har_model_acc.json, stress_model.json)
ml/har/, ml/stress/      training / evaluation / export scripts and results
tests/                   Jest tests + Python-generated fixtures
docs/                    ARCHITECTURE, ML_REPORT, STRESS_DATASET, STATUS, screenshots/
data/                    UCI HAR dataset (raw inertial signals) and the stress dataset download
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, data flow, inference workflow and storage
- [docs/ML_REPORT.md](docs/ML_REPORT.md): datasets, features, models, results and limitations
- [docs/STRESS_DATASET.md](docs/STRESS_DATASET.md): detailed provenance analysis of the stress dataset
- [docs/STATUS.md](docs/STATUS.md): what's implemented, what was tested, what remains
- [docs/publishing/RELEASE_CHECKLIST.md](docs/publishing/RELEASE_CHECKLIST.md): everything left before store submission
- [docs/publishing/STORE_LISTING.md](docs/publishing/STORE_LISTING.md), [PRIVACY_LABELS.md](docs/publishing/PRIVACY_LABELS.md), [docs/legal/](docs/legal/): store copy, privacy answers, privacy policy and terms

## Troubleshooting

- **"Project is incompatible with this version of Expo Go"**: install Expo Go 58.x (see the emulator steps above).
- **Phone can't connect on LAN**: confirm the phone and computer share a network. Windows Firewall must allow Node.js inbound (Public profile on public networks). Otherwise use `--tunnel`.
- **`INSTALL_FAILED_INSUFFICIENT_STORAGE` on the emulator**: free space (`adb shell pm trim-caches 4G`) or uninstall the old Expo Go first.
- **Live predictions look wrong**: the model expects the phone sideways at the waist (as in the UCI study). The Activity screen warns when gravity points along a different axis. Try Recorded replay to see the model on in-distribution data.
- **Stale bundle**: `npx expo start --clear`.

## Data sources and licences

- UCI Human Activity Recognition Using Smartphones: Anguita, Ghio, Oneto, Parra & Reyes-Ortiz (2013), CC BY 4.0.
- Student Lifestyle Dataset (Kaggle, steve1215rogg): Apache 2.0 as declared by the uploader. Its labels are rule-derived; see `docs/STRESS_DATASET.md`.
