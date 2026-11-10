# Dawn

Wren's own light identity (2026-10-31; the app was renamed from WellTrack AI to Wren on 2026-11-10). It replaces the earlier dark "Evening" design. Tokens live in `src/theme/tokens.ts`.

**Identity, not imitation.** Reference screenshots from other journaling apps inform *mechanisms* only: streaks, a week view, a compose menu, a collapsing tab bar and period trends. Layouts, copy and visual language must stay Wren's own. A copycat look risks App Store rejection (guideline 4.1).

- **Palette:** warm paper `#F6F2EC` canvas, `#FFFDF9` surfaces, ink-navy `#1F2A44` text and primary actions, Wren's mint `#2C8F7B`, and a sunrise peach `#E8956B`.
- **Mood colours** match Wren's mood owls: slate, blue, sky, mint, peach (1–5).
- **Type:** Fraunces for display, titles, headings, prompts and big numbers (prompts in italic). Figtree for interface text.
- **Wren the owl** is the centrepiece. On Today, Wren sits in a sky that follows the time of day, and you check in by tapping the owl that matches your mood. Trends uses the five mood owls in its mood breakdown.
- **Today:**
  - a serif greeting;
  - a "This week" card of mood beads (filled with that day's mood colour; a dot means you wrote that day) and a leaf streak chip;
  - the sky card;
  - a lined "Today's page" notebook card holding the prompt of the day;
  - a "Write" pill at the bottom right that opens a card menu.
- **The crew:** Wren the owl (feelings, journal), Pika the pika (movement, recording) and Char the small ember dragon (study, exams). Flat SVG art on a 120 grid in `src/components/ui/Companions.tsx`, with poses idle, cheer and sleep. Each speaks in a short line of their own voice, never medical and never guilt-tripping. Explore groups tools under the companion who owns them, as plain grouped lists, not icon-card grids. Onboarding and sign-in introduce all three.
- **Tab bar:** Today · Journal · Wren · Trends · Explore. It floats, collapses to the current tab's icon on scroll-down, and expands on scroll-up or tap. The full bar and the icon pill crossfade (no morph). On iOS 26 both are Liquid Glass (`Glass` in `src/components/ui/Glass.tsx`), and the material animates on and off rather than being faded with opacity. Native iOS tabs were tried; their minimize-on-scroll never triggered. Settings sits behind the avatar.
- **Trends:**
  - a Week / Month / Year segmented control;
  - an owl with the average-mood figure and a sentence ("A steady stretch");
  - rounded-square tile calendars;
  - section labels with a mint bar;
  - a floating period control that tucks in beside the collapsed tab bar.
- **Layout:** 24px gutters, 24px card corners, 32px hero corners, soft warm shadows, and touch targets of at least 44–48px. Respect safe areas, text scaling and reduced motion.
- **Dusk (dark):** the same identity at night: deep navy paper `#121621`, `#1B2030` surfaces with hairline borders, cream text, and cream `ink` for primary actions, with `onInk` for the text on them. Settings → Appearance offers System, Dawn or Dusk; the default follows the phone. The time-of-day sky card and the owls are illustrations and look the same in both themes.
- **Liquid Glass (iOS 26):** only floating chrome uses it: the tab bar, the Write pill, the Trends period switcher and native navigation headers or sheets. Content cards stay on paper.
- **Theme code:** never import colours statically. Use `useTheme()` for inline colours and `const styles = useStyles(makeStyles)` with `makeStyles = (c: Palette, t: Theme) => StyleSheet.create(...)` (`src/theme/ThemeProvider.tsx`). Text and icons on an `ink` background use `onInk`; on teal or violet fills they use `textOnAccent`.
- **Data honesty:** missing data shows an explicit empty state, never demo values. Every derived reading carries a source tag (self-reported, measured, AI, on-device estimate).
