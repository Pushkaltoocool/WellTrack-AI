# Wren

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Product Purpose

A student wellbeing companion: daily check-ins and a journal, all-day activity from the phone's motion history plus Wren's own activity model, wellness suggestions and goals, and trends that relate stress to movement. It's a wellness tool, not a medical device. Formerly "WellTrack AI". The EAS slug and bundle ID keep that name.

## Capabilities and Constraints

- **Stack:** Expo SDK 58, React Native, TypeScript, Expo Router, and local SQLite as the source of truth.
- **Accounts:** a Firebase account is required (email, Apple or Google). It backs up a private copy of the user's data.
- **Research data:** labelled sensor recordings and daily activity and stress rows upload only with explicit, withdrawable research consent.
- **Location:** never used for tracking. On iOS it is borrowed only to keep a recording alive while the screen is locked, and every reading is discarded.
- **Preserve:** real tracking, recorded replay (kept out of personal stats), check-in validation, editable history, goals, model explanations, export and deletion.

## Brand Commitments

Wren and its crew are the brand:

- **Wren the owl:** calm; feelings and the journal.
- **Pika the pika:** quick and cheerful; movement and recording.
- **Char the small ember dragon:** fiery but kind; study and exams.

All three are original characters. The user asked for Pokémon-alike versions and was told no. Never imitate existing IP or other apps' copy. Sample values in designs are examples; always show real stored data.

## Evidence on Hand

The implementation, README and DESIGN.md establish behaviour and look. The original `WellTrack AI — redesign.html` is historical reference only, for the previous Evening design.
