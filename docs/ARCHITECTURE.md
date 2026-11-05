# WellTrack AI — Architecture

## 1. Overview

WellTrack is a single Expo (SDK 58) app that runs in **Expo Go**. Sensors, ML inference and storage run on the device; SQLite is the source of truth. Two optional online services sit beside it: Firebase (Auth + a Firestore backup snapshot) and an LLM for the coach (OpenRouter, directly in development or through `functions/` in release). Python is used only offline to train and export models.

```
┌──────────────────────────── Expo Go (device) ─────────────────────────────┐
│  src/app (Expo Router screens)                                             │
│      │ hooks: useData / useDbQuery / useTracker                            │
│  ┌───▼───────────────┐   ┌──────────────────────┐   ┌───────────────────┐ │
│  │ DataProvider      │   │ TrackerProvider       │   │ features/wellness │ │
│  │ (SQLite, prefs,   │◄──┤ (sensor lifecycle,    │   │ recommendation    │ │
│  │  change version)  │   │  replay, 10 Hz UI)    │   │ engine, service   │ │
│  └───┬───────────────┘   └───┬──────────────────┘   └────────┬──────────┘ │
│      │                       │ samples                      │             │
│  services/database       services/sensors/windower   services/ml          │
│  (schema, migrations,    (timestamp resampling,      (harFeatures.ts,      │
│   repositories)           128/64 windows)             inference.ts,        │
│                               │ windows               harModel, stress)    │
│                          features/activity/trackingEngine ─► predictions   │
└────────────────────────────────────────────────────────────────────────────┘
          ▲ bundled JSON (models/*.json, src/assets/replay/*.json)
          │
   ml/har/train_har.py, ml/stress/train_stress.py  (offline, Python)
```

## 2. Module responsibilities

| Module | Responsibility |
|---|---|
| `src/app/_layout.tsx` | Root providers (SafeArea, theme, `DataProvider`, `TrackerProvider`) and the Stack navigator |
| `src/app/index.tsx` | Gate: onboarding or `/home` depending on the `onboardingComplete` preference |
| `src/app/(tabs)/*` | Home, Activity, Support (wellness), Trends, Settings tabs |
| `src/app/{checkin,stress,focus,breathing,support,onboarding}.tsx` | Stack screens |
| `src/components/ui/Glass.tsx` | `LIQUID_GLASS` flag and `GlassSurface`: native `GlassView` on iOS 26+, plain tinted `View` fallback elsewhere. Used by `Card`, `Button`, `StatTile`, `Segmented` and `Screen` chrome |
| `src/features/activity/stepHistory.ts` | iOS-only all-day steps: day ranges, permission, throttled Core Motion sync into `daily_steps` |
| `src/components/ui` | Design system: `Screen`, `Card`, `Button`, `AppText`, `SourceTag` (data provenance), `StatTile`, `ProgressRing/Bar`, `Segmented`, `Notice`, `EmptyState`, `KeyValue` |
| `src/components/charts` | SVG charts: stacked `BarChart`, gap-aware `LineChart`, `LiveSignalChart`, `BreakdownBar` |
| `src/features/activity/TrackerProvider.tsx` | Owns sensor subscriptions, pedometer, replay timer, AppState handling, session persistence; publishes a snapshot at 10 Hz |
| `src/features/activity/trackingEngine.ts` | Pure: window → features → model → majority smoothing → duration accounting |
| `src/features/activity/orientation.ts` | Pure: gravity-direction placement check vs. the UCI training placement |
| `src/features/activity/replayData.ts` | Builds replay programmes (single clips and full tours) from held-out recordings |
| `src/services/sensors/windower.ts` | Pure: merges asynchronous accelerometer and gyroscope streams onto a 50 Hz grid, emits 128-sample windows every 64 samples, and resets on gaps over 0.25 s |
| `src/services/ml/harFeatures.ts` | Exact TypeScript port of `ml/har/features.py` (82 features) |
| `src/services/ml/inference.ts` | Generic inference for exported scikit-learn models (logistic regression, decision tree, random forest) plus decision-path explanation |
| `src/services/ml/harModel.ts`, `stressModel.ts` | Load the bundled model JSON, map inputs and expose typed predictions |
| `src/features/wellness/recommendationEngine.ts` | Pure, deterministic rules. Each rule returns evidence drawn from user data |
| `src/features/wellness/wellnessService.ts` | Write orchestration: save check-in → stress estimate → refresh recommendations |
| `src/features/analytics/aggregations.ts` | Pure aggregation for dashboards and trends (replay sessions always excluded) |
| `src/services/firebase/*` | Firebase app/auth/firestore init from `EXPO_PUBLIC_*` env; account actions (email, Google, Apple, re-auth, delete); pure error mapping in `authErrors.ts` |
| `src/services/cloud/AccountProvider.tsx`, `backup.ts` | Auth state; snapshot backup to `users/{uid}/backup/*` (chunked < 1 MiB), debounced auto-backup (15 s / app background), restore, first-sign-in link flow, cloud deletion |
| `src/services/database/backupFormat.ts` | Portable export format shared by file export/import and cloud backup: validation, preference sanitising, chunking |
| `src/services/ai/llm.ts` | OpenRouter chat completions with model fallback, low reasoning effort, empty-reply retry, friendly errors |
| `src/features/coach/*` | Coach context builder (14-day summary, notes opt-in, length cap), system prompt, crisis detection, turn orchestration |
| `src/features/insights/*` | Weekly recap, pattern finder, personal ridge-regression stress model with LOO validation, loader shared with the coach |
| `src/features/reminders/*` | Pure reminder planning, local notification scheduling, sync hook and tap routing |
| `src/features/security/AppLock.tsx` | Biometric / passcode gate on launch and after 30 s in background; app-switcher cover |
| `src/services/database/*` | Schema and migrations, repositories, exclusive transaction queue, `DataProvider`/`useDbQuery` |

Screens contain only presentation and wiring. Business logic lives in pure modules that are unit-tested without React or native modules.

## 3. Data flows

### Live tracking
```
Accelerometer / Gyroscope (expo-sensors, 20 ms interval, timestamps in s)
  → TrackerProvider callbacks (write to refs only; iOS acceleration sign-flipped to Android/UCI convention)
  → SensorWindower.push*()  — linear interpolation onto a 50 Hz grid, gap reset
  → 6×128 window every 1.28 s
  → ActivityEngine.processWindow(): extractFeatures → logistic regression → majority(3) smoothing
  → durations[label] += 2.56 s (first window of a segment) or 1.28 s
  → 10 Hz UI tick publishes snapshot → Activity / Home screens
Stop → insertSession(source='live') → refreshRecommendations → invalidate()
```
- Subscriptions exist only while status is `tracking`. Pause, stop, discard, app backgrounding (`AppState`) and provider unmount all remove them. The live count shows in Settings → Diagnostics and Activity → Sensor health.
- Raw samples live in memory only (bounded buffers and a 3 s chart history). Only per-session summaries are written.
- Without a gyroscope, the windower runs accelerometer-only and the engine uses `har-logreg-acc-v1`.

### Recorded replay
Identical to live tracking, except samples come from `src/assets/replay/har_replay.json` with exact 1/50 s timestamps. Playback is paced from wall-clock time, at 1× or 4×. The recorded label is shown next to each prediction. Sessions are stored with `source='replay'` and excluded from every personal statistic.

### Check-in → estimate → suggestions
```
checkin.tsx → validateCheckIn → saveCheckIn():
   upsertCheckIn (unique per date) → predictStress (study, sleep) → saveAssessment (one per day)
   → refreshRecommendations (last 14 days of check-ins + today's live sessions + prefs)
   → syncRecommendations (keeps user status, refreshes evidence, prunes untouched rules that no longer fire)
→ invalidate() → every mounted useDbQuery re-runs
```

## 4. Inference workflow

1. Offline: `ml/har/train_har.py` extracts features with `features.py`, selects hyperparameters with subject-grouped CV on the training subjects, evaluates on the held-out test subjects, and exports `models/har_model.json` (scaler mean/scale, coefficients, intercepts, metadata, metrics).
2. Offline: the same script writes `tests/fixtures/har_fixtures.json` (48 raw held-out windows with Python features and probabilities) and the replay recordings.
3. On device: `harFeatures.ts` reproduces the features. `inference.ts` standardises them and computes softmax(Wx + b).
4. CI and local: `tests/harParity.test.ts` checks that every TypeScript feature matches Python to within 1e-9 (relative) and that predictions and probabilities match to within 1e-7. `tests/stressParity.test.ts` does the same for the stress tree. Tree thresholds are compared in float32 (`Math.fround`), as scikit-learn does.

## 5. Storage

SQLite database `welltrack.db`. The schema version lives in `PRAGMA user_version`, and migrations in `src/services/database/schema.ts` are applied in order inside transactions at startup.

| Table | Contents |
|---|---|
| `preferences` | key/value JSON (name, onboarding flag, goals, smoothing) |
| `checkins` | one row per local date (unique) |
| `activity_sessions` | session summary: source (`live`/`replay`), per-class seconds (JSON), window count, steps (nullable), model id, mean sample rate |
| `stress_assessments` | one per date: model id, predicted class, leaf distribution, exact inputs |
| `goals`, `goal_logs` | goals and per-day completion |
| `recommendations` | generated suggestions per date and rule with user status (`new`/`accepted`/`completed`/`dismissed`) |
| `exams`, `coach_messages` (v3) | exam/deadline planner; the coach conversation |
| `daily_steps` (v2) | one row per date: step total read from the OS step history (iOS Core Motion), source, sync time |

All write transactions go through a single queue (`transaction()` in `db.ts`). expo-sqlite's `withTransactionAsync` is not exclusive on a shared connection, and the Home and Support tabs refresh recommendations concurrently. Before this queue was added, that concurrency caused a real failure that showed up during emulator testing.

Data never leaves the device unless the user explicitly exports JSON through the system share sheet. "Delete all data" clears every table and returns to onboarding.

## 6. UI state and performance

- Tabs use the native system tab bar (`expo-router/native-tabs`). On iOS, `Screen` lets UIKit adjust scroll insets (`contentInsetAdjustmentBehavior="automatic"`) for the safe area and the floating glass tab bar instead of adding manual safe-area padding. On Android it keeps manual padding.

- `useDbQuery(fn, deps)` re-runs on dependency change, after any write (a global data version bump) and on screen focus. `loading` is derived from a request key.
- Sensor callbacks never call `setState`. The tracker publishes at 10 Hz, and charts render at most 150 points per axis.
- The React Compiler is enabled, and the code passes its ESLint rules (no ref reads during render, no synchronous setState in effects).

## 7. Accounts, backup and the coach

```
Sign-in (account.tsx) → linkAfterSignIn():
   no cloud backup        → upload snapshot
   cloud + empty device   → restore (importAll, one transaction)
   cloud + local data     → ask: use cloud / keep this phone
Any write → data version bump → 15 s debounce (or app background) → backupToCloud(): export → chunked docs → meta → prune stale chunks
Delete account → re-authenticate → delete Firestore docs → delete auth user
```
Firestore rules (`firestore.rules`) allow each user to read and write only `users/{uid}/**`; everything else is denied.

```
Coach turn: save user message → loadInsights + goals + exams → buildCoachContext (≤2.5k chars)
  → [system prompt, context, last 12 turns] → OpenRouter (models: Gemma 4 → Nemotron → Gemma 4 small)
  → save reply (model id) → UI shows "AI-generated · model"
Crisis phrases trigger a local emergency card before and independently of the model.
```
