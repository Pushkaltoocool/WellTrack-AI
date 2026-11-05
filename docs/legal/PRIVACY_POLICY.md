# WellTrack AI — Privacy Policy

_Effective: [DATE OF FIRST RELEASE] · Contact: [SUPPORT EMAIL — set before publishing]_

WellTrack AI ("WellTrack", "we") is a wellbeing journal for students. This policy explains what the app collects, where it goes, and the choices you have. WellTrack is a wellness tool, not a medical device, and it does not diagnose or treat any condition.

## The short version

- Your journal (check-ins, goals, exams, activity summaries) is stored **on your phone**.
- An **account is optional**. If you create one, a private backup of your journal is stored in your account so you can restore it on another phone. Only you can read it.
- The **AI coach is optional** and off until you agree. When you chat, your messages and a short summary of your recent check-ins are sent to an AI provider to generate a reply.
- **No ads, no analytics SDKs, no tracking, no selling of data.** Raw motion-sensor data never leaves your phone.
- You can **export** your data, **delete** it from the phone, and **delete your account** (with its backup) inside the app at any time.

## 1. Data stored on your phone

| Data | Why |
|---|---|
| Daily check-ins: sleep, study, screen time, physical activity, social time, extracurricular time, academic pressure, stress, mood, optional note | Your journal, trends, suggestions and insights |
| Activity sessions: time per recognised activity (walking, stairs, sitting, standing, lying down), step count during sessions | Movement summaries |
| Daily step totals (iPhone only, if you turn on all-day steps) | Step trends |
| Goals, suggestions, exams and deadlines, AI coach conversation, settings | App features |

Motion-sensor readings (accelerometer, gyroscope) are processed in memory while a tracking session you started is running; only per-session summaries are saved. Activity recognition and the personal stress model run entirely on your phone.

## 2. Account and cloud backup (optional)

If you create an account we use **Google Firebase** (Firebase Authentication and Cloud Firestore, operated by Google LLC) to:

- store your **email address**, an optional **display name**, and a hashed password (or the identifier from Sign in with Apple / Google, if you use those);
- store a **backup copy of the data in section 1** under your account.

Security rules restrict each backup so that only the signed-in account owner can read or write it. Data is encrypted in transit (TLS) and at rest by Google. Backups are stored in Google Cloud region asia-northeast3 (Seoul). You can turn automatic backup off, and you can delete your account and its backup in **Settings → Account → Delete account**.

## 3. AI coach (optional)

The coach ("Wren") only sends data after you tap **Agree and start**. When you send a message, the app sends:

- your message and the recent conversation;
- a summary of your last 14 days: check-in values, goals, upcoming exams, step totals and simple weekly statistics;
- your check-in notes **only if** you turn on "Share check-in notes".

This is sent to **OpenRouter, Inc.**, which routes it to an AI model provider (currently Google's Gemma models or NVIDIA's Nemotron models) to generate a reply. These providers process the request under their own terms and privacy policies; free model endpoints may log prompts. WellTrack does not store your conversation on its own servers. [If the release uses the WellTrack proxy:] Requests pass through a WellTrack server function that checks you are signed in and counts requests per day; it does not store message content.

You can stop using the coach at any time (Settings → AI coach → Turn off) and clear the conversation from your phone.

## 4. Notifications and app lock

Reminders are scheduled locally on your phone; no push service is used. App lock uses your phone's built-in Face ID, Touch ID, fingerprint or passcode; WellTrack never receives biometric data.

## 5. What we don't do

We don't show ads, use advertising identifiers, include third-party analytics or tracking SDKs, sell or share your data for advertising, or use your data to train AI models.

## 6. Retention

- On your phone: until you delete it (Settings → Delete all data) or uninstall the app.
- Account and backup: until you delete your account. Deletion removes the backup immediately; Google may keep deleted data in backups for a limited period under its own policies.
- AI coach requests: governed by OpenRouter's and the model provider's retention policies.

## 7. Your rights

You can access and export your data (Settings → Export data), correct it (edit any check-in), delete it, and withdraw consent for the AI coach or backups at any time. Depending on where you live (for example under GDPR or similar laws) you may have additional rights, including complaining to a data-protection authority. Contact us at [SUPPORT EMAIL].

## 8. Children

WellTrack is designed for students aged 13 and over and is not directed to children under 13. If you believe a child under 13 has created an account, contact us and we will delete it.

## 9. Health information

WellTrack is not a medical service. Information in the app, including AI coach replies, is not medical advice. If you feel unsafe or in crisis, contact local emergency services or a crisis line (findahelpline.com lists free lines by country).

## 10. Changes

We will update this page and the effective date if this policy changes, and tell you in the app about significant changes.
