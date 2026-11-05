# WellTrack AI — Status

_Last updated: 2026-10-31. Environment: Windows 11, Node 24.14.1, Expo SDK 58.0.21, Expo Go 58.0.5, Android emulator `amzden_android16` (Android 16 / API 36). Everything below runs in **Expo Go**; items marked "dev build" need the development build planned for next week._

## Implemented

| Area | Status |
|---|---|
| **Dawn redesign**: WellTrack's own light identity (see `DESIGN.md`). Five floating tabs (Today · Journal · Wren · Trends · Explore) that collapse to the current tab's icon on scroll; Settings behind the avatar | ✅ verified on emulator (screenshots 72–85) |
| **Journal**: editor with live formatting (title, heading, subheading, quote, bold, italic, underline, strike), "Keep going" follow-up questions, tags, date, writing stats, autosave, delete | ✅ verified on emulator |
| **Emotion reading**: on-device keyword estimate by default; AI reading (with separate consent) names up to 3 feelings, a heavy-to-light tone, what lifts or weighs on you, and a short reflection. Crisis language always shows support | ✅ AI and offline fallback both verified on emulator |
| **Journal insights**: feelings this month, a heavier-days card (3 of the last 7 days), a "Go gently" suggestion, Trends cards; the coach gets feeling names only, never entry text | ✅ |
| **Trends**: week / month / year with the previous period, mood map, mood owls, journal feelings, sleep and activity, breathing and focus calendars (both now logged) | ✅ |
| **Dusk** dark theme: follows the phone by default, or pick System / Dawn / Dusk in Settings → Appearance. Switches live with no restart | ✅ verified on emulator (screenshots 94–102) |
| **Journal search**: words, feelings, what lifted or weighed on you, `#tags`; accent- and case-insensitive | ✅ verified on emulator |
| **On this day**: a Today card with what you wrote a week, a month or a year ago (only when an entry exists) | ✅ Jest · not seen on emulator yet (no entries that old) |
| **Wren's weekly letter** (`/letter`): built on the phone from the last 7 days; optional AI rewrite from the same facts (coach consent; never entry text). Card on Journal, and on Today on Sundays | ✅ Jest + empty state on emulator · ⏳ full letter needs 3 logged days |
| **Journal export** as PDF or Markdown via the share sheet | ✅ PDF verified on emulator (print preview) |
| **Mood buttons on the check-in reminder** (5 on iOS, 3 on Android) open the check-in with that mood picked | ✅ buttons shown on emulator · ⚠️ in Expo Go, tapping a button doesn't bring the app forward; check in the dev build |
| **Apple HealthKit** (`@kingstinct/react-native-healthkit`, read-only): sleep, steps, active energy, mindful minutes, daylight | ✅ code + 14 tests · ⏳ dev build on an iPhone; inert in Expo Go |
| Onboarding, daily check-in (6 steps), edit history, validation | ✅ |
| Live activity recognition (`har-logreg-v1`), acc-only fallback, recorded replay, orientation check | ✅ |
| All-day step history on iPhone (Core Motion, opt-in) | ✅ code + Jest · ⏳ not yet run on an iPhone |
| Suggestions engine with evidence, goals, streaks; **new** exam-week and persistent-low-mood rules | ✅ |
| **Accounts** (Firebase Auth): email/password sign-up and sign-in, email verification, password reset, sign-out | ✅ verified on emulator against the live project |
| Google and Sign in with Apple | ✅ code · ⏳ dev build only (hidden in Expo Go) |
| **Cloud backup and restore** (Firestore, chunked snapshot, debounced auto-backup, first-sign-in conflict prompt) | ✅ code + Jest · ⚠️ blocked until Firestore rules are deployed (see Known issues) |
| **Account deletion** in-app (re-auth → delete cloud data → delete auth user) | ✅ code · ⚠️ cloud step blocked by the same rules; fails safely with a clear message |
| **Wren, AI coach** (OpenRouter free models with fallback): consent screen, context from your data, notes opt-in, crisis handling, retry, provenance tag | ✅ verified with live requests on emulator |
| **Insights**: weekly recap, personal patterns, **personal stress model** (on-device ridge regression, LOO-validated, shown only if ≥20 % better than baseline) | ✅ |
| **Exams & deadlines** planner: countdowns, Today card, suggestions, evening-before reminders | ✅ |
| **Reminders** (local notifications): daily check-in, wind-down, exams | ✅ scheduling verified (2 scheduled) · delivery not observed |
| **App lock** (biometrics or device passcode; covers content in app switcher) | ✅ code · Face ID needs dev build; emulator has no screen lock |
| **Restore from a JSON file**; export | ✅ verified on emulator |
| Support page link to findahelpline.com | ✅ |
| Release config: bundle IDs, permission strings, iOS privacy manifest, `eas.json`, Firestore rules, AI proxy function, legal pages | ✅ prepared · deployment needs you (see `docs/publishing/RELEASE_CHECKLIST.md`) |

## Verification

### Automated
| Command | Result |
|---|---|
| `npx jest` | **180 / 180 tests pass** (12 suites) |
| `npx tsc --noEmit` (strict) | 0 errors |
| `npx expo lint` | 0 problems |
| `npx expo-doctor` | 20 / 20 checks passed |
| `cd functions && npx tsc --noEmit` | 0 errors (proxy not deployed) |
| Android bundle | HTTP 200, 1,916 modules |

New tests cover: backup format validation and preference sanitising, Firestore chunking, auth error mapping and sign-up validation, reminder planning (times, exam-eve rules, 60-day horizon), exam countdowns, relative times, exam-week and low-mood rules, weekly recap, patterns (sample sizes, no causal wording), the personal model (beats baseline on signal; "not better" on noise; insufficient below 30 days), coach context (notes off by default, length cap) and crisis detection (urgent vs concern vs figures of speech).

### Manual on the Android emulator in Expo Go (screenshots 60–70 in `docs/screenshots/`)
| Flow | Result |
|---|---|
| App launches with all new modules, schema migrates v2 → v3 | ✅ |
| Create account → signed in → account screen (verify-email prompt, backup status) → sign out | ✅ (63, 64) |
| First backup | ⚠️ refused: "Missing or insufficient permissions" (rules not deployed); shown as a readable message |
| Delete account | ⚠️ stops safely at cloud-data step for the same reason; account not half-deleted |
| AI coach: consent → starter prompt → grounded reply (sleep, screen time, exams from the user's data) | ✅ (65, 66) |
| AI coach: crisis message → local emergency card + careful AI reply | ✅ (70) |
| Add exam (Android date picker) → countdown on Today → exam-week suggestion becomes the top suggestion | ✅ (67) |
| Insights with real data: recap numbers and "check in on 6 more days" state | ✅ (68) |
| Daily reminder on → notification permission → 2 reminders scheduled (check-in + exam eve) | ✅ (69) |
| App lock without a phone screen lock → explains why it can't turn on | ✅ |
| Restore from file (picker → summary → replace) | ✅ |

### Bugs found and fixed tonight
- Reasoning models spent the 600-token budget "thinking" and returned empty replies. The budget is now 1,500 with low reasoning effort, plus one automatic retry and a "Try again" button.
- Coach markdown showed raw `**` and the last line overlapped the AI tag. Added a small markdown renderer and made assistant bubbles full-width.
- Expo Go rejects `setNotificationChannelAsync` on Android (native NullPointerException), which aborted all reminders. Channel creation is now best-effort, and reminders fall back to the default channel.
- Reading a document-picker file failed in Expo Go ("Missing READ permission"). Switched to `File.pickFileAsync`.
- "Delete all data" would have let auto-backup overwrite the cloud copy with empty data. It now says so explicitly and clears the backup deliberately.
- The personal model's default gate reported pure noise as "ready" about 13 % of the time at 21 days. The gate is now 30 days and a 20 % improvement (about 2 % false positives in simulation).

### Journal and redesign session (screenshots 72–85)
- Bug found: closing the editor through a remount could save a second copy of an entry. Fixed by having autosave remember the id it created; the duplicate was deleted.
- OpenRouter's free Gemma models were rate-limited (429) and Nemotron Super timed out. The fallback list is now Nemotron Ultra, then Gemma 31B, then Nemotron Lightning, in both the app and `functions/`. The app's offline fallback was verified when every model failed.
- Database migrations v4 (journal entries, practice sessions) and v5 (tags, writing time) applied cleanly on the emulator.

### Dusk and small additions (screenshots 94–102)
- Bug found and fixed: in Expo Go the share sheet couldn't read the PDF where the print module saves it. The app now asks for the PDF bytes and writes its own file.
- Bug found and fixed: SDK 58's `File.write` returns a promise. The JSON data export didn't await it, so it could share a half-written file.
- Off-state switch tracks were invisible in Dusk; they now use `borderStrong` everywhere.

## Known issues
- **Firestore rules not deployed.** Deploying was blocked by the session's permission policy. Run `python -I scripts/deploy_firestore_rules.py <service-account.json>`. Until then, backup, restore and the cloud step of account deletion fail with a clear message.
- **QA account left in Firebase Auth:** `qa+1793381309@example.com`. Delete it in the Firebase console, or in-app once the rules are deployed.
- **AI coach quota:** the free OpenRouter key gives 50 requests per day for the whole app. Fine for development, not for release (see the release checklist).
- Custom Android notification channel is unavailable in Expo Go (default channel used).
- Face ID app lock, Google and Apple sign-in, background tracking and HealthKit / Health Connect need the development build.
- Carried over: placement shift for activity recognition, sitting vs standing confusion, foreground-only tracking, and the experimental rule-labelled public stress model (now complemented by the personal model).

## Next steps (priority order)
1. Deploy Firestore rules, then test backup → delete app data → restore, and account deletion.
2. Decide the bundle ID and support email; deploy the legal pages (Firebase Hosting).
3. Next week, the dev build: `expo-dev-client`, EAS env vars, register iOS/Android apps in Firebase, enable Apple sign-in, then test Face ID, Google/Apple sign-in and notification channels.
4. Production AI: Blaze plan + `functions/` proxy + OpenRouter credits, or ship 1.0 with the coach hidden.
5. In the dev build: connect Apple Health in Trends or Settings and compare the numbers with the Health app. Then Android Health Connect and a home-screen widget.
6. Journal attachments (photos, voice memos) need media storage and backup sizing first.
