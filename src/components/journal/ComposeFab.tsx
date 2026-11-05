import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { TAB_BAR_HEIGHT, tabBarBottom, useKeyboardVisible } from '@/components/ui/tabBarState';
import { promptForDay } from '@/features/journal/prompts';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { todayKey } from '@/lib/dates';
import { AI_ENABLED } from '@/services/ai/llm';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { radii, type Palette } from '@/theme/tokens';

type Item = { label: string; body: string; icon: keyof typeof Ionicons.glyphMap; tint: string; href: Href };

/** "Write" pill above the tab bar; opens a small card of ways to write or check in. */
export function ComposeFab() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const keyboard = useKeyboardVisible();
  const [open, setOpen] = useState(false);
  if (keyboard) return null;
  const bottom = tabBarBottom(insets.bottom) + TAB_BAR_HEIGHT + 14;
  const prompt = promptForDay(todayKey());
  const items: Item[] = [
    { label: 'Blank page', body: 'Write whatever is on your mind', icon: 'create-outline', tint: colors.ink, href: '/entry' },
    { label: 'Today’s prompt', body: prompt, icon: 'sparkles-outline', tint: colors.peach, href: { pathname: '/entry', params: { prompt } } },
    { label: 'Daily check-in', body: 'Mood, sleep and study in six steps', icon: 'happy-outline', tint: colors.teal, href: '/checkin' },
    ...(AI_ENABLED ? [{ label: 'Talk to Wren', body: 'Your AI coach', icon: 'chatbubble-ellipses-outline', tint: colors.primary, href: '/coach' } as const] : []),
  ];
  const toggle = (next: boolean) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setOpen(next);
  };
  const go = (href: Href) => {
    setOpen(false);
    router.push(href);
  };
  return <>
    <Pressable onPress={() => toggle(true)} accessibilityRole="button" accessibilityLabel="Write or check in"
      style={({ pressed }) => [styles.fab, { bottom }, pressed && { transform: [{ scale: 0.96 }] }]}>
      <Ionicons name="create-outline" size={20} color={colors.onInk} />
      <AppText variant="bodyStrong" color={colors.onInk}>Write</AppText>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close menu" accessibilityRole="button" />
      <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(180)} style={[styles.menu, { bottom }]}>
        {items.map((item, i) => (
          <Pressable key={item.label} onPress={() => go(item.href)} accessibilityRole="button" accessibilityLabel={item.label}
            style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { backgroundColor: colors.bg }]}>
            <View style={[styles.icon, { backgroundColor: `${item.tint}1F` }]}><Ionicons name={item.icon} size={21} color={item.tint} /></View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{item.label}</AppText>
              <AppText variant="caption" muted numberOfLines={1}>{item.body}</AppText>
            </View>
          </Pressable>
        ))}
        <Pressable onPress={() => toggle(false)} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={20} color={colors.textSecondary} /><AppText variant="bodyStrong" secondary>Close</AppText>
        </Pressable>
      </Animated.View>
    </Modal>
  </>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  fab: { position: 'absolute', right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, height: 54, paddingHorizontal: 22, borderRadius: 18, backgroundColor: c.ink, ...t.shadow.float },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.dark ? c.overlay : 'rgba(31,42,68,0.28)' },
  menu: { position: 'absolute', right: 16, left: 16, maxWidth: 420, alignSelf: 'flex-end', borderRadius: radii.lg, backgroundColor: c.surface, paddingTop: 6, overflow: 'hidden', ...t.shadow.float },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, minHeight: 68 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  close: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 52, backgroundColor: c.bg },
});
