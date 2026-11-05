import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Eyebrow } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { AI_ENABLED } from '@/services/ai/llm';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { radii, type Palette } from '@/theme/tokens';

type Tool = { title: string; body: string; icon: keyof typeof Ionicons.glyphMap; href: Href; dark?: boolean };

const GROUPS: { label: string; tools: Tool[] }[] = [
  {
    label: 'Feel better now',
    tools: [
      { title: 'Slow breathing', body: 'Two minutes of box breathing', icon: 'leaf-outline', href: '/breathing', dark: true },
      { title: 'Focus & breaks', body: 'Study blocks with real rests', icon: 'timer-outline', href: '/focus' },
      ...(AI_ENABLED ? [{ title: 'Talk to Wren', body: 'Your AI coach', icon: 'chatbubble-ellipses-outline', href: '/coach' } as const] : []),
      { title: 'Get support', body: 'Helplines and campus services', icon: 'heart-outline', href: '/support' },
    ],
  },
  {
    label: 'Plan',
    tools: [
      { title: 'Exams & deadlines', body: 'Countdowns and reminders', icon: 'school-outline', href: '/exams' },
      { title: 'Suggestions & goals', body: 'Small habits you can track', icon: 'flag-outline', href: '/wellness' },
    ],
  },
  {
    label: 'Understand',
    tools: [
      { title: 'Insights', body: 'Weekly recap and your patterns', icon: 'analytics-outline', href: '/insights' },
      { title: 'Movement', body: 'On-device activity recognition', icon: 'walk-outline', href: '/activity' },
      { title: 'Stress estimate', body: 'Experimental, from check-ins', icon: 'pulse-outline', href: '/stress' },
    ],
  },
  {
    label: 'You',
    tools: [
      { title: 'Account & backup', body: 'Sign in and sync', icon: 'cloud-outline', href: '/account' },
      { title: 'Settings', body: 'Reminders, privacy, data', icon: 'settings-outline', href: '/settings' },
    ],
  },
];

export default function Explore() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Screen title="Explore" subtitle="Tools for calmer days, all in one place.">
      {GROUPS.map((g, gi) => (
        <View key={g.label}>
          <Eyebrow style={gi === 0 ? { marginTop: 8 } : undefined}>{g.label}</Eyebrow>
          <View style={styles.grid}>
            {g.tools.map((t) => (
              <Pressable
                key={t.title}
                onPress={() => router.push(t.href)}
                accessibilityRole="button"
                accessibilityLabel={`${t.title}. ${t.body}`}
                style={({ pressed }) => [styles.tile, t.dark && styles.tileDark, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
                <View style={[styles.icon, t.dark && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                  <Ionicons name={t.icon} size={22} color={t.dark ? '#FFFFFF' : colors.text} />
                </View>
                <View style={{ gap: 2 }}>
                  <AppText variant="bodyStrong" color={t.dark ? '#FFFFFF' : colors.text} style={{ fontSize: 17 }}>
                    {t.title}
                  </AppText>
                  <AppText variant="caption" color={t.dark ? '#C9CBD0' : colors.textSecondary}>
                    {t.body}
                  </AppText>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: '46%', minHeight: 148, borderRadius: radii.lg, backgroundColor: c.surface, padding: 18, justifyContent: 'space-between', gap: 16, ...t.shadow.card },
  tileDark: t.dark ? { backgroundColor: t.gradients.hero[1], borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong } : { backgroundColor: c.ink },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
