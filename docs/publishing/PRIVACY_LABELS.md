# App privacy answers

These answers match the current code. Re-check them if analytics, crash reporting or new SDKs are added.

## Apple: App Privacy ("nutrition label")

**Tracking:** No. No data is used to track users across apps or websites, and there's no IDFA or ad SDK.

| Data type (Apple category) | Collected? | Linked to user | Purpose | Notes |
|---|---|---|---|---|
| Contact Info → Email address | Yes (an account is required) | Yes | App Functionality | Firebase Auth |
| Contact Info → Name | Optional | Yes | App Functionality | Display name |
| Health & Fitness → Fitness (steps, activity minutes, labelled motion recordings) | Yes: account backup; with research consent, raw accelerometer/gyroscope recordings and daily activity summaries | Yes | App Functionality; Other Purposes (model training) | Research sharing is opt-in (app/research.tsx) and withdrawable |
| Health & Fitness → Health (sleep, mood, stress self-reports; Apple Health reads stay on the device) | Yes: backup, AI coach, and (with research consent) daily stress ratings | Yes | App Functionality; Other Purposes (research) | Backup copy; AI coach summary; research days |
| User Content → Other user content (journal entries, notes, goals, exams, coach messages) | Yes, only in backup, when the user uses the AI coach, or when they opt in to AI journal readings | Yes | App Functionality | Journal text goes to the AI provider only after separate consent |
| Identifiers → User ID | Yes, with an account | Yes | App Functionality | Firebase UID |
| Usage Data, Diagnostics, Location, Contacts, Financial, Browsing, Purchases | No | — | — | All-day activity uses the OS motion history only, never location |

"Collected" means data leaves the device. Purely on-device data, such as the journal without an account, doesn't count as collected under Apple's definition.

**Third-party AI:** list the AI coach under the Health and User Content rows (purpose: App Functionality). Under guideline 5.1.2(i), the in-app consent screen discloses the data sent and the recipient (OpenRouter and model providers) before anything is shared.

**Location (iOS):** only while a labelled recording runs with "Keep recording when I lock my phone" on. Wren starts coarse (3 km) location updates purely so iOS keeps the app running, and the native delegate discards every reading: nothing is stored, logged or sent, so Location stays **Not collected**. Explain this in the App Review notes, since the app declares the `location` background mode.

**Android background model:** the opt-in foreground service (type `health`) samples motion sensors with a visible notification. In Play Console, declare the health foreground-service type and use it in the store listing's feature description.

## Google Play: Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all user data encrypted in transit?** Yes (HTTPS/TLS).
- **Can users request their data be deleted?** Yes: in-app deletion and the web page link.

| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Personal info → Email, Name | Yes | No | Email required (account required), name optional | Account management |
| Health and fitness → Health info, Fitness info | Yes | Yes, with the AI provider when the coach is used | Yes | App functionality; research (opt-in motion recordings and daily summaries) |
| Messages → Other in-app messages (coach chat) | Yes | Yes, with the AI provider | Yes | App functionality |
| App activity → Other user-generated content (journal, notes, goals, exams) | Yes | AI provider only with journal-AI consent or notes sharing on | Yes | App functionality |
| Device or other IDs | No | — | — | — |

"Shared" covers transfers to a third party that aren't a service provider acting on your behalf. OpenRouter and model providers process requests for the user's chosen feature. Declaring them as shared is the conservative choice; confirm against Play's current definitions when you submit.

**Account deletion URL** (Play requirement): https://welltrackai-128b4.web.app/ (lists the in-app path and the support email).
