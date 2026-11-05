import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ScreenBackground } from '@/components/ui/Screen';
import { useData } from '@/services/database/DataProvider';
import { FIREBASE_ENABLED } from '@/services/firebase/app';
import { createGoal } from '@/services/database/repositories';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';
import type { GoalCategory } from '@/types/domain';

type IconName = keyof typeof Ionicons.glyphMap;

const SLIDES: { icon: IconName; color: keyof Palette; title: string; body: string; points: string[] }[] = [
  {
    icon: 'sparkles',
    color: 'cyan',
    title: 'Welcome to WellTrack AI',
    body: 'Your personal student wellness companion. Monitor → Understand → Predict → Recommend → Improve.',
    points: ['No account needed', 'Everything stays on this phone', 'Built for students'],
  },
  {
    icon: 'walk',
    color: 'primary',
    title: 'Activity recognition',
    body:
      'While you track in the foreground, a machine-learning model reads your accelerometer and gyroscope and recognises six activities: walking, upstairs, downstairs, sitting, standing and lying down.',
    points: [
      'Trained on the UCI HAR smartphone dataset (30 people)',
      'Works best with the phone at your waist, like the training data',
      'Live accuracy can differ from the dataset’s test accuracy',
    ],
  },
  {
    icon: 'create-outline',
    color: 'teal',
    title: 'Daily wellness check-ins',
    body: 'Log sleep, study, screen time, activity, social time, stress and mood in about a minute. You can edit today’s entry any time.',
    points: ['Trends over 7 and 30 days', 'Self-reported data is always labelled as such'],
  },
  {
    icon: 'analytics-outline',
    color: 'violet',
    title: 'Stress-risk estimate (experimental)',
    body:
      'WellTrack includes an experimental model trained on a public student lifestyle dataset. That dataset’s labels come from a simple rule on study and sleep hours, so the estimate is shown with clear caveats — never as a diagnosis.',
    points: ['Not a medical device', 'Your own stress rating is always shown alongside'],
  },
  {
    icon: 'shield-checkmark-outline',
    color: 'amber',
    title: 'Sensors & privacy',
    body:
      'Motion sensors are used only while you tap Start Tracking with the app open. Raw sensor readings are processed in memory; only session summaries are saved.',
    points: ['Data stored locally in SQLite', 'No cloud, no telemetry, no account', 'Export or delete everything in Settings'],
  },
];

const GOAL_OPTIONS: { key: string; title: string; description: string; category: GoalCategory; icon: IconName }[] = [
  { key: 'sleep', title: 'Sleep 7–9 hours', description: 'Aim for a full night of sleep.', category: 'sleep', icon: 'moon-outline' },
  { key: 'move', title: 'Move 30 minutes', description: 'Get at least 30 minutes of movement.', category: 'movement', icon: 'walk-outline' },
  { key: 'breaks', title: 'Take study breaks', description: 'Pause every 50 minutes of study.', category: 'study', icon: 'timer-outline' },
  { key: 'stress', title: 'Daily wind-down', description: 'Spend 5 minutes on a calming activity.', category: 'stress', icon: 'leaf-outline' },
];

export default function Onboarding() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, updatePrefs } = useData();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState(0);
  const [name, setName] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const total = SLIDES.length + 1;

  const goTo = (p: number) => {
    scroller.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };

  const finish = async () => {
    setSaving(true);
    try {
      for (const g of GOAL_OPTIONS.filter((o) => goals.includes(o.key))) {
        await createGoal(db, { title: g.title, description: g.description, category: g.category });
      }
      await updatePrefs({ onboardingComplete: true, displayName: name.trim().slice(0, 40), initialGoals: goals });
      router.replace('/home');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenBackground />
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        keyboardShouldPersistTaps="handled">
        {SLIDES.map((s) => (
          <ScrollView key={s.title} style={{ width }} contentContainerStyle={[styles.slide, { paddingTop: insets.top + 56 }]}>
            <View style={styles.heroIconWrap}>
              <LinearGradient colors={[`${colors[s.color]}55`, `${colors[s.color]}11`]} style={styles.heroIcon}>
                <Ionicons name={s.icon} size={52} color={colors[s.color]} />
              </LinearGradient>
            </View>
            <AppText variant="display" align="center">
              {s.title}
            </AppText>
            <AppText secondary align="center" style={{ marginTop: spacing.md }}>
              {s.body}
            </AppText>
            <View style={styles.points}>
              {s.points.map((p) => (
                <View key={p} style={styles.point}>
                  <Ionicons name="checkmark-circle" size={18} color={colors[s.color]} />
                  <AppText variant="caption" secondary style={{ flex: 1 }}>
                    {p}
                  </AppText>
                </View>
              ))}
            </View>
          </ScrollView>
        ))}
        <ScrollView
          style={{ width }}
          contentContainerStyle={[styles.slide, { paddingTop: insets.top + 40 }]}
          keyboardShouldPersistTaps="handled">
          <AppText variant="display">Let’s set you up</AppText>
          <AppText secondary style={{ marginTop: spacing.sm }}>
            Both are optional — you can change them later in Settings.
          </AppText>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
            What should we call you?
          </AppText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="First name or nickname"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            maxLength={40}
            accessibilityLabel="Your name"
            returnKeyType="done"
          />
          <AppText variant="bodyStrong" style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
            Pick a few starting goals
          </AppText>
          <View style={styles.goalGrid}>
            {GOAL_OPTIONS.map((g) => {
              const on = goals.includes(g.key);
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGoals((cur) => (on ? cur.filter((x) => x !== g.key) : [...cur, g.key]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.goalChip, on && styles.goalChipOn]}>
                  <Ionicons name={g.icon} size={20} color={on ? colors.cyan : colors.textSecondary} />
                  <AppText variant="caption" color={on ? colors.text : colors.textSecondary} style={{ flex: 1 }}>
                    {g.title}
                  </AppText>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={on ? colors.cyan : colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
          <AppText variant="caption" muted style={{ marginTop: spacing.lg }}>
            WellTrack AI is a wellness tool, not a medical device. It does not diagnose, treat or prevent any condition.
          </AppText>
          {FIREBASE_ENABLED ? (
            <Button label="I already have an account" icon="person-circle-outline" variant="ghost" small onPress={() => router.push('/account?from=onboarding')} style={{ marginTop: spacing.md }} />
          ) : null}
        </ScrollView>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <View style={styles.footerRow}>
          {page < total - 1 ? (
            <>
              <Button label="Skip" variant="ghost" onPress={() => goTo(total - 1)} style={{ flex: 1 }} />
              <Button label="Next" icon="arrow-forward" onPress={() => goTo(page + 1)} style={{ flex: 2 }} />
            </>
          ) : (
            <Button label="Get started" icon="rocket-outline" onPress={finish} loading={saving} style={{ flex: 1 }} testID="onboarding-finish" />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  slide: { paddingHorizontal: spacing.xxl, paddingBottom: 160 },
  heroIconWrap: { alignItems: 'center', marginBottom: spacing.xxl },
  heroIcon: {
    width: 120,
    height: 120,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  points: { marginTop: spacing.xxl, gap: spacing.md },
  point: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: c.surface,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  input: {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.borderStrong,
    color: c.text,
    paddingHorizontal: spacing.lg,
    minHeight: 50,
    fontSize: 16,
  },
  goalGrid: { gap: spacing.sm },
  goalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  goalChipOn: { borderColor: c.cyan, backgroundColor: c.cyanSoft },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xxl, gap: spacing.lg, backgroundColor: c.bg, paddingTop: spacing.md },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.borderStrong },
  dotActive: { width: 22, backgroundColor: c.cyan },
});
