import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { AI_ENABLED } from '@/services/ai/llm';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

import { AppText } from './AppText';
import { TAB_BAR_COLLAPSED, TAB_BAR_HEIGHT, tabBarBottom, useKeyboardVisible, useTabBar } from './tabBarState';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type IconName = keyof typeof Ionicons.glyphMap;
const DESTINATIONS: { name: string; label: string; icon: IconName; activeIcon: IconName }[] = [
  { name: 'home', label: 'Today', icon: 'home-outline', activeIcon: 'home' },
  { name: 'journal', label: 'Journal', icon: 'book-outline', activeIcon: 'book' },
  ...(AI_ENABLED ? [{ name: 'coach', label: 'Wren', icon: 'chatbubble-ellipses-outline', activeIcon: 'chatbubble-ellipses' } as const] : []),
  { name: 'trends', label: 'Trends', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'explore', label: 'Explore', icon: 'compass-outline', activeIcon: 'compass' },
];
/** Tab routes reached from other screens that hide the bar (they have their own back button). */
const HIDDEN = new Set(['activity', 'wellness']);

export function FloatingTabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const keyboard = useKeyboardVisible();
  const { collapsedRoute, setCollapsedRoute } = useTabBar();
  const active = state.routes[state.index].name;
  if (HIDDEN.has(active) || keyboard) return null;
  const collapsed = collapsedRoute === active;
  const current = DESTINATIONS.find((d) => d.name === active) ?? DESTINATIONS[0];
  const layout = reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(220);
  const fade = reduceMotion ? undefined : FadeIn.duration(160);
  const fadeOut = reduceMotion ? undefined : FadeOut.duration(100);

  const press = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const selected = active === name;
    void Haptics.selectionAsync().catch(() => undefined);
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!selected && !event.defaultPrevented) navigateToTab(route.key);
  };

  return <View pointerEvents="box-none" style={[styles.container, { bottom: tabBarBottom(insets.bottom) }]}>
    <Animated.View layout={layout} style={[styles.bar, collapsed ? styles.barCollapsed : styles.barExpanded]} accessibilityRole="tablist">
      {collapsed ? <Animated.View key="collapsed" entering={fade} exiting={fadeOut}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${current.label}. Show all tabs`}
          onPress={() => setCollapsedRoute(null)} style={({ pressed }) => [styles.collapsedButton, pressed && { opacity: 0.7 }]}>
          <Ionicons name={current.icon} size={25} color={colors.text} />
        </Pressable>
      </Animated.View> : <Animated.View key="expanded" entering={fade} exiting={fadeOut} style={styles.row}>
        {DESTINATIONS.map((tab) => {
          const selected = active === tab.name;
          return <Pressable key={tab.name} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
            onPress={() => press(tab.name)}
            onLongPress={() => { const r = state.routes.find((x) => x.name === tab.name); if (r) emitter.emit({ type: 'tabLongPress', target: r.key }); }}
            style={({ pressed }) => [styles.tab, selected && styles.selected, pressed && { opacity: 0.7 }]}>
            <Ionicons name={selected ? tab.activeIcon : tab.icon} size={23} color={selected ? colors.text : colors.textSecondary} />
            {fontScale <= 1.3 ? <AppText variant="micro" numberOfLines={1} color={selected ? colors.text : colors.textSecondary} style={styles.label}>{tab.label}</AppText> : null}
          </Pressable>;
        })}
      </Animated.View>}
    </Animated.View>
  </View>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  container: { position: 'absolute', left: 16, right: 16, alignItems: 'flex-start' },
  bar: { backgroundColor: t.dark ? `${c.surface}F5` : 'rgba(255,255,255,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong, borderRadius: 999, ...t.shadow.float },
  barExpanded: { width: '100%', maxWidth: 520, alignSelf: 'center', height: TAB_BAR_HEIGHT, padding: 5 },
  barCollapsed: { width: TAB_BAR_COLLAPSED, height: TAB_BAR_COLLAPSED, marginBottom: (TAB_BAR_HEIGHT - TAB_BAR_COLLAPSED) / 2 },
  row: { flex: 1, flexDirection: 'row', gap: 2 },
  tab: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 },
  selected: { backgroundColor: c.surfaceAlt },
  label: { fontSize: 11.5, letterSpacing: 0 },
  collapsedButton: { width: TAB_BAR_COLLAPSED - 2, height: TAB_BAR_COLLAPSED - 2, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
});
