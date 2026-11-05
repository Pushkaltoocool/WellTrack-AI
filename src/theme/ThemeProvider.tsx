import Storage from 'expo-sqlite/kv-store';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { gradientsFor, palettes, riskColorsFor, shadowFor, type Palette, type Scheme } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Theme {
  colors: Palette;
  scheme: Scheme;
  dark: boolean;
  gradients: ReturnType<typeof gradientsFor>;
  shadow: ReturnType<typeof shadowFor>;
  riskColors: ReturnType<typeof riskColorsFor>;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const MODE_KEY = 'welltrack.themeMode';

/** Read synchronously so the first frame is already in the right theme (no flash of Dawn at night). */
function readMode(): ThemeMode {
  try {
    const v = Storage.getItemSync(MODE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function build(scheme: Scheme, mode: ThemeMode, setMode: (m: ThemeMode) => void): Theme {
  const colors = palettes[scheme];
  return { colors, scheme, dark: scheme === 'dark', gradients: gradientsFor(colors, scheme), shadow: shadowFor(colors, scheme), riskColors: riskColorsFor(colors), mode, setMode };
}

const ThemeContext = createContext<Theme>(build('light', 'system', () => undefined));

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const scheme: Scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const theme = useMemo(() => build(scheme, mode, (m: ThemeMode) => {
    setModeState(m);
    try { Storage.setItemSync(MODE_KEY, m); } catch { /* the choice still applies for this session */ }
  }), [scheme, mode]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => undefined);
  }, [theme.colors.bg]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Theme-aware styles. Declare `const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({...})`
 * at module scope and call `const styles = useStyles(makeStyles)` inside each component that uses them.
 */
export function useStyles<T>(factory: (c: Palette, theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme.colors, theme), [factory, theme]);
}
