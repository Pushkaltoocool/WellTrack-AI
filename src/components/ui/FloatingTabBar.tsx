/**
 * Floating tab bar on every platform. On scroll-down it collapses to the current tab's icon; the
 * full bar and the icon pill are two fixed shapes that crossfade, so nothing resizes mid-animation.
 * iOS 26: both shapes are Liquid Glass. Glass must not sit under opacity < 1, so there the material
 * animates on/off natively and only the icons fade. Elsewhere the solid surfaces fade as a whole.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import { useEffect, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

import { AppText } from './AppText';
import { Glass, useLiquidGlass } from './Glass';
import { TAB_BAR_COLLAPSED, TAB_BAR_HEIGHT, TAB_DESTINATIONS, tabBarBottom, useKeyboardVisible, useTabBar } from './tabBarState';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const FADE_MS = 180;

export function FloatingTabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const keyboard = useKeyboardVisible();
  const glass = useLiquidGlass();
  const { collapsedRoute, setCollapsedRoute } = useTabBar();
  const active = state.routes[state.index].name;
  const collapsed = collapsedRoute === active;
  const current = TAB_DESTINATIONS.find((d) => d.name === active) ?? TAB_DESTINATIONS[0];

  const progress = useSharedValue(collapsed ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion ? (collapsed ? 1 : 0) : withTiming(collapsed ? 1 : 0, { duration: FADE_MS });
  }, [collapsed, progress, reduceMotion]);
  const barFade = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const pillFade = useAnimatedStyle(() => ({ opacity: progress.value }));

  if (keyboard) return null;

  const press = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const selected = active === name;
    void Haptics.selectionAsync().catch(() => undefined);
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!selected && !event.defaultPrevented) navigateToTab(route.key);
  };

  // Glass: shape stays opaque-to-the-compositor, contents fade. Solid: the whole shape fades.
  const outerBar = glass ? undefined : barFade;
  const innerBar = glass ? barFade : undefined;
  const outerPill = glass ? undefined : pillFade;
  const innerPill = glass ? pillFade : undefined;

  return <View pointerEvents="box-none" style={[styles.container, { bottom: tabBarBottom(insets.bottom) }]}>
    <Animated.View pointerEvents={collapsed ? 'none' : 'auto'} importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
      style={[styles.barPos, outerBar]} accessibilityRole="tablist">
      <Glass style={styles.bar} fallbackStyle={styles.solid} materialHidden={collapsed} interactive>
        <Animated.View style={[styles.row, innerBar]}>
          {TAB_DESTINATIONS.map((tab) => {
            const selected = active === tab.name;
            return <Pressable key={tab.name} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
              onPress={() => press(tab.name)}
              onLongPress={() => { const r = state.routes.find((x) => x.name === tab.name); if (r) emitter.emit({ type: 'tabLongPress', target: r.key }); }}
              style={({ pressed }) => [styles.tab, selected && (glass ? styles.selectedGlass : styles.selected), pressed && { opacity: 0.7 }]}>
              <Ionicons name={selected ? tab.activeIcon : tab.icon} size={23} color={selected ? colors.text : colors.textSecondary} />
              {fontScale <= 1.3 ? <AppText variant="micro" numberOfLines={1} color={selected ? colors.text : colors.textSecondary} style={styles.label}>{tab.label}</AppText> : null}
            </Pressable>;
          })}
        </Animated.View>
      </Glass>
    </Animated.View>
    <Animated.View pointerEvents={collapsed ? 'auto' : 'none'} importantForAccessibility={collapsed ? 'auto' : 'no-hide-descendants'}
      style={[styles.pillPos, outerPill]}>
      <Glass style={styles.pill} fallbackStyle={styles.solid} materialHidden={!collapsed} interactive>
        <Animated.View style={[{ flex: 1 }, innerPill]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${current.label}. Show all tabs`}
            onPress={() => setCollapsedRoute(null)} style={({ pressed }) => [styles.pillButton, pressed && { opacity: 0.7 }]}>
            <Ionicons name={current.activeIcon} size={25} color={colors.text} />
          </Pressable>
        </Animated.View>
      </Glass>
    </Animated.View>
  </View>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  container: { position: 'absolute', left: 16, right: 16, height: TAB_BAR_HEIGHT },
  solid: { backgroundColor: t.dark ? `${c.surface}F5` : 'rgba(255,255,255,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong, ...t.shadow.float },
  barPos: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: { width: '100%', maxWidth: 520, height: TAB_BAR_HEIGHT, padding: 5, borderRadius: TAB_BAR_HEIGHT / 2 },
  row: { flex: 1, flexDirection: 'row', gap: 2 },
  pillPos: { position: 'absolute', left: 0, bottom: (TAB_BAR_HEIGHT - TAB_BAR_COLLAPSED) / 2 },
  pill: { width: TAB_BAR_COLLAPSED, height: TAB_BAR_COLLAPSED, borderRadius: TAB_BAR_COLLAPSED / 2 },
  tab: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 },
  selected: { backgroundColor: c.surfaceAlt },
  selectedGlass: { backgroundColor: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(31,42,68,0.07)' },
  label: { fontSize: 11.5, letterSpacing: 0 },
  pillButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
});
