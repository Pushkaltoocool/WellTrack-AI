/**
 * Dawn (light) and Dusk (dark) — Wren's own identity: warm paper surfaces, ink-navy text and
 * actions, Wren's mint and a sunrise peach, Fraunces for display type. Dusk is the same identity at
 * night: deep navy paper, cream ink. Read theme colours through `useTheme()` / `useStyles()` from
 * `ThemeProvider.tsx`; only scheme-independent tokens are exported statically from here.
 */
export const dawn = {
  bg: '#F6F2EC', bgElevated: '#FFFDF9', surface: '#FFFDF9',
  surfaceAlt: '#EFE8DE', surfacePressed: '#E6DDD0', border: '#E8E0D4', borderStrong: '#D3C8B8',
  text: '#1C2333', textSecondary: '#555C6B', textMuted: '#6B7080', textOnAccent: '#FFFFFF',
  /** Primary actions (buttons, Write pill, done) and the text/icons drawn on them. */
  ink: '#1F2A44', inkSoft: '#34405E', onInk: '#FFFFFF',
  primary: '#2F6F8F', primarySoft: '#2F6F8F1A', sky: '#8DB3D9', skySoft: '#8DB3D933',
  cyan: '#4F86B8', cyanSoft: '#4F86B81A',
  teal: '#2C8F7B', tealSoft: '#2C8F7B1F', violet: '#7466C4', violetSoft: '#7466C41A',
  amber: '#B8732A', amberSoft: '#B8732A1A', rose: '#D0564C', roseSoft: '#D0564C1A',
  peach: '#E8956B', peachSoft: '#E8956B26', mint: '#6FD3BE', overlay: '#1F2A4466',
  /** Notebook rules and other faint lines drawn on surfaces. */
  rule: '#ECE4D8',
  shadow: '#5A4630',
};
export type Palette = { readonly [K in keyof typeof dawn]: string };

export const dusk: Palette = {
  bg: '#121621', bgElevated: '#1B2030', surface: '#1B2030',
  surfaceAlt: '#252B3D', surfacePressed: '#2F3649', border: '#2A3144', borderStrong: '#3B4359',
  text: '#F1EBE2', textSecondary: '#BDB7AE', textMuted: '#9A968F', textOnAccent: '#10131C',
  ink: '#EFE7DA', inkSoft: '#D9D0C1', onInk: '#1C2333',
  primary: '#86BBDA', primarySoft: '#86BBDA24', sky: '#8DB3D9', skySoft: '#8DB3D92E',
  cyan: '#82B0DD', cyanSoft: '#82B0DD22',
  teal: '#55BDA6', tealSoft: '#55BDA626', violet: '#A398EC', violetSoft: '#A398EC24',
  amber: '#E2A660', amberSoft: '#E2A66024', rose: '#EF8478', roseSoft: '#EF847826',
  peach: '#F0A27D', peachSoft: '#F0A27D2E', mint: '#6FD3BE', overlay: '#000000A6',
  rule: '#283048',
  shadow: '#000000',
};

export type Scheme = 'light' | 'dark';
export const palettes: Record<Scheme, Palette> = { light: dawn, dark: dusk };

export function gradientsFor(c: Palette, scheme: Scheme) {
  const hero = scheme === 'dark' ? (['#26304A', '#33405F'] as const) : (['#1F2A44', '#34405E'] as const);
  return {
    screen: [c.bg, c.bg, c.bg] as const,
    hero,
    primary: [c.ink, c.ink] as const, ml: [c.violet, c.violet] as const,
    teal: [c.teal, c.teal] as const, cyan: [c.cyan, c.cyan] as const,
  };
}
export function shadowFor(c: Palette, scheme: Scheme) {
  const dark = scheme === 'dark';
  return {
    card: { shadowColor: c.shadow, shadowOpacity: dark ? 0.3 : 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: dark ? 0 : 1 },
    float: { shadowColor: dark ? '#000000' : '#1F2A44', shadowOpacity: dark ? 0.45 : 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  } as const;
}
export function riskColorsFor(c: Palette) {
  return { Low: c.teal, Moderate: c.amber, High: c.rose } as const;
}

/** Sky behind Wren on Today, by time of day. Dusk keeps the same skies. */
export function skyFor(hour: number): readonly [string, string] {
  if (hour >= 5 && hour < 10) return ['#F9D9C2', '#BFD6EE'];
  if (hour >= 10 && hour < 17) return ['#CFE4F5', '#EAF3FA'];
  if (hour >= 17 && hour < 21) return ['#F3B79A', '#8C8FC7'];
  return ['#1F2A44', '#3B4A72'];
}
/** Mood 1–5 — the same colours as Wren's mood owls (slate, blue, sky, mint, peach). Readable on both themes. */
export const moodColors = ['#6B7590', '#7F9BE0', '#A9C1E8', '#6FD3BE', '#EDBB8A'] as const;
export const activityColors: Record<string, string> = {
  WALKING: '#2C8F7B', RUNNING: '#E8956B', WALKING_UPSTAIRS: '#2F6F8F', WALKING_DOWNSTAIRS: '#8DB3D9',
  SITTING: '#7466C4', STANDING: '#B8732A', LAYING: '#D0564C',
};
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radii = { sm: 12, md: 16, lg: 24, xl: 32, pill: 999 } as const;
export const fonts = { body: 'Figtree', medium: 'FigtreeMedium', semibold: 'FigtreeSemiBold', bold: 'FigtreeBold', display: 'Fraunces', italic: 'FrauncesItalic' } as const;
export const type = {
  display: { fontFamily: fonts.display, fontSize: 36, lineHeight: 43, fontWeight: '400' as const, letterSpacing: -0.6 },
  title: { fontFamily: fonts.display, fontSize: 27, lineHeight: 34, fontWeight: '400' as const, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, fontWeight: '400' as const, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
  caption: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  micro: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.3 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  metric: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, fontWeight: '400' as const, letterSpacing: -0.5 },
  mono: { fontSize: 13, lineHeight: 19, fontFamily: 'monospace' },
} as const;
export const touchTarget = 48;
