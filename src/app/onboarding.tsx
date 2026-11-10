import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { COMPANIONS, Companion, type CompanionId } from '@/components/ui/Companions';
import { ScreenBackground } from '@/components/ui/Screen';
import { enableAllDay, motionSupported } from '@/features/motion/motionSync';
import { useData } from '@/services/database/DataProvider';
import { createGoal } from '@/services/database/repositories';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';
import type { GoalCategory } from '@/types/domain';

type IconName = keyof typeof Ionicons.glyphMap;

/** One page per companion, in their own voice. */
const INTROS: { id: CompanionId; title: string; body: string; aside: string }[] = [
  {
    id: 'wren',
    title: 'Hi, I’m Wren.',
    body: 'I notice how your days actually feel. Tap the owl that matches your mood, write a few lines if you like, and I’ll show you what lifts you and what weighs on you.',
    aside: 'Your journal is yours: readable only by you, backed up to your account.',
  },
  {
    id: 'pika',
    title: 'I’m Pika!',
    body: 'I keep count of how you move: walks, runs, stairs, sitting, even sleep. Your phone’s motion chip does the noticing, so it barely touches the battery.',
    aside: 'All-day tracking is motion only. I never track where you go.',
  },
  {
    id: 'char',
    title: 'And I’m Char.',
    body: 'Exams, deadlines, long library days. I help you plan them, guard real breaks, and remind you the night before something big.',
    aside: 'Wren is a wellness app, not a medical device. It doesn’t diagnose or treat anything.',
  },
];

const GOAL_OPTIONS: { key: string; title: string; description: string; category: GoalCategory; icon: IconName; by: CompanionId }[] = [
  { key: 'sleep', title: 'Sleep 7–9 hours', description: 'Aim for a full night of sleep.', category: 'sleep', icon: 'moon-outline', by: 'wren' },
  { key: 'move', title: 'Move 30 minutes', description: 'Get at least 30 minutes of movement.', category: 'movement', icon: 'walk-outline', by: 'pika' },
  { key: 'breaks', title: 'Take study breaks', description: 'Pause every 50 minutes of study.', category: 'study', icon: 'timer-outline', by: 'char' },
  { key: 'stress', title: 'Daily wind-down', description: 'Spend 5 minutes on a calming activity.', category: 'stress', icon: 'leaf-outline', by: 'wren' },
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
  const [goals, setGoals] = useState<string[]>(['move']);
  const [allDay, setAllDay] = useState(motionSupported());
  const [saving, setSaving] = useState(false);
  const total = INTROS.length + 1;
  const last = page === total - 1;

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
      // Asking here means the motion prompt arrives right after Pika explains what it's for.
      const allDayActivity = allDay && motionSupported() ? (await enableAllDay()) === 'granted' : false;
      await updatePrefs({ onboardingComplete: true, displayName: name.trim().slice(0, 40), initialGoals: goals, allDayActivity });
      router.replace('/home');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenBackground />
      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} keyboardShouldPersistTaps="handled">
        {INTROS.map((s) => (
          <ScrollView key={s.id} style={{ width }} contentContainerStyle={[styles.page, { paddingTop: insets.top + 40 }]}>
            <View style={styles.stage}>
              <View style={[styles.ground, { backgroundColor: `${COMPANIONS[s.id].color}1F` }]} />
              <Companion id={s.id} size={196} pose={s.id === 'wren' ? 'idle' : 'cheer'} />
            </View>
            <AppText variant="display" style={styles.headline}>{s.title}</AppText>
            <AppText style={styles.body}>{s.body}</AppText>
            {s.id === 'pika' && motionSupported() ? (
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">Notice my activity all day</AppText>
                  <AppText variant="caption" muted>Your phone asks for Motion & Fitness when you finish.</AppText>
                </View>
                <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: colors.teal, false: colors.borderStrong }} accessibilityLabel="Notice my activity all day" />
              </View>
            ) : null}
            <AppText variant="caption" muted style={styles.aside}>{s.aside}</AppText>
          </ScrollView>
        ))}

        <ScrollView style={{ width }} contentContainerStyle={[styles.page, { paddingTop: insets.top + 40 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.trio}>
            <Companion id="pika" size={84} pose="cheer" />
            <Companion id="wren" size={104} />
            <Companion id="char" size={84} pose="cheer" />
          </View>
          <AppText variant="display" style={styles.headline}>What should we call you?</AppText>
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
          <AppText variant="title" style={styles.goalsTitle}>Pick a goal or two</AppText>
          <View style={styles.goalList}>
            {GOAL_OPTIONS.map((g, i) => {
              const on = goals.includes(g.key);
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGoals((cur) => (on ? cur.filter((x) => x !== g.key) : [...cur, g.key]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [styles.goalRow, i > 0 && styles.goalDivider, pressed && { backgroundColor: colors.surfaceAlt }]}>
                  <Companion id={g.by} size={34} />
                  <AppText variant="bodyStrong" style={{ flex: 1 }}>{g.title}</AppText>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? COMPANIONS[g.by].color : colors.borderStrong} />
                </Pressable>
              );
            })}
          </View>
          <AppText variant="caption" muted style={styles.aside}>You can change all of this later in Settings.</AppText>
        </ScrollView>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.progress} accessibilityLabel={`Page ${page + 1} of ${total}`}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[styles.tick, i <= page && { backgroundColor: i < INTROS.length ? COMPANIONS[INTROS[i].id].color : colors.ink }]} />
          ))}
        </View>
        <View style={styles.footerRow}>
          {!last ? <Button label="Skip" variant="ghost" onPress={() => goTo(total - 1)} style={{ flex: 1 }} /> : null}
          <Button label={last ? 'Let’s go' : 'Next'} icon={last ? 'arrow-forward' : undefined} onPress={last ? finish : () => goTo(page + 1)}
            loading={saving} style={{ flex: 2 }} testID={last ? 'onboarding-finish' : undefined} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  page: { paddingHorizontal: spacing.xxl, paddingBottom: 170 },
  stage: { alignItems: 'center', justifyContent: 'flex-end', height: 230, marginBottom: 28 },
  ground: { position: 'absolute', bottom: 4, width: 190, height: 30, borderRadius: 95 },
  headline: { fontSize: 38, lineHeight: 44, letterSpacing: -0.6 },
  body: { fontSize: 18, lineHeight: 27, color: c.textSecondary, marginTop: 14 },
  aside: { marginTop: 22 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 26, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: c.surface, borderRadius: radii.lg },
  trio: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4, marginBottom: 26 },
  input: { marginTop: 18, backgroundColor: c.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong, color: c.text, paddingHorizontal: spacing.lg, minHeight: 54, fontSize: 18 },
  goalsTitle: { marginTop: 34, marginBottom: 12 },
  goalList: { backgroundColor: c.surface, borderRadius: radii.lg, overflow: 'hidden' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 16 },
  goalDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xxl, gap: spacing.lg, backgroundColor: c.bg, paddingTop: spacing.md },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  progress: { flexDirection: 'row', gap: 6 },
  tick: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.border },
});
