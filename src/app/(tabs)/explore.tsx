import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { COMPANIONS, Companion, lineOfTheDay, type CompanionId } from '@/components/ui/Companions';
import { Screen } from '@/components/ui/Screen';
import { todayKey } from '@/lib/dates';
import { AI_ENABLED } from '@/services/ai/llm';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { radii, type Palette } from '@/theme/tokens';

type Tool = { title: string; body: string; href: Href };

/** Each companion looks after a corner of the day; their tools sit with them. */
const CREW: { id: CompanionId; nudge: { label: string; href: Href }; tools: Tool[] }[] = [
  {
    id: 'pika',
    nudge: { label: 'See your day in motion', href: '/activity' },
    tools: [
      { title: 'Movement', body: 'Your day, walked, run and sat', href: '/activity' },
      { title: 'Record an activity', body: 'Teach the model how you move', href: '/collect' },
    ],
  },
  {
    id: 'char',
    nudge: { label: 'Start a focus block', href: '/focus' },
    tools: [
      { title: 'Focus & breaks', body: 'Study blocks with real rests', href: '/focus' },
      { title: 'Exams & deadlines', body: 'Countdowns and a nudge the night before', href: '/exams' },
      { title: 'Goals', body: 'Small habits worth keeping', href: '/wellness' },
    ],
  },
  {
    id: 'wren',
    nudge: { label: 'Breathe for two minutes', href: '/breathing' },
    tools: [
      { title: 'Slow breathing', body: 'Two minutes of box breathing', href: '/breathing' },
      ...(AI_ENABLED ? [{ title: 'Talk to Wren', body: 'Think it through together', href: '/coach' } as const] : []),
      { title: 'Insights', body: 'Your week, and what moves your mood', href: '/insights' },
      { title: 'Stress estimate', body: 'Experimental, from your check-ins', href: '/stress' },
      { title: 'Get support', body: 'Helplines and campus services', href: '/support' },
    ],
  },
];

const YOU: Tool[] = [
  { title: 'Account & backup', body: 'Sign-in and cloud copy', href: '/account' },
  { title: 'Research sharing', body: 'What you contribute, if anything', href: '/research' },
  { title: 'Settings', body: 'Reminders, privacy, your data', href: '/settings' },
];

/** Morning belongs to Pika, the afternoon to Char, the evening to Wren. */
function companionForNow(): CompanionId {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'pika' : h >= 12 && h < 18 ? 'char' : 'wren';
}

export default function Explore() {
  const styles = useStyles(makeStyles);
  const [speaker, setSpeaker] = useState<CompanionId>(companionForNow);
  const crew = CREW.find((c) => c.id === speaker) ?? CREW[0];
  const meta = COMPANIONS[speaker];

  const pick = (id: CompanionId) => {
    if (id === speaker) return;
    void Haptics.selectionAsync().catch(() => undefined);
    setSpeaker(id);
  };

  return (
    <Screen title="Explore">
      <View style={styles.stage} accessibilityRole="radiogroup" accessibilityLabel="Choose a companion">
        {CREW.map((c) => {
          const on = c.id === speaker;
          return <Pressable key={c.id} onPress={() => pick(c.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            accessibilityLabel={`${COMPANIONS[c.id].name}, ${COMPANIONS[c.id].role}`} style={styles.member}>
            <View style={[styles.figure, !on && styles.figureQuiet]}>
              <Companion id={c.id} size={on ? 104 : 76} pose={on ? 'cheer' : 'idle'} />
            </View>
            <AppText variant="bodyStrong" style={[styles.name, !on && styles.nameQuiet]}>{COMPANIONS[c.id].name}</AppText>
          </Pressable>;
        })}
      </View>

      <View style={styles.bubble} accessibilityLiveRegion="polite">
        <View style={[styles.bubbleTail, { left: `${(CREW.findIndex((c) => c.id === speaker) * 2 + 1) * (100 / 6)}%` }]} />
        <AppText style={styles.quote}>{lineOfTheDay(speaker, todayKey())}</AppText>
        <Pressable onPress={() => router.push(crew.nudge.href)} accessibilityRole="button" hitSlop={8} style={styles.nudge}>
          <AppText variant="bodyStrong" color={meta.color}>{crew.nudge.label}</AppText>
          <Ionicons name="arrow-forward" size={16} color={meta.color} />
        </Pressable>
      </View>

      {CREW.map((c) => (
        <View key={c.id} style={styles.section}>
          <View style={styles.sectionHead}>
            <Companion id={c.id} size={30} />
            <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">{COMPANIONS[c.id].name}</AppText>
            <AppText variant="caption" muted>{COMPANIONS[c.id].role.toLowerCase()}</AppText>
          </View>
          <ToolList tools={c.tools} />
        </View>
      ))}

      <View style={styles.section}>
        <AppText variant="title" style={[styles.sectionTitle, styles.youTitle]} accessibilityRole="header">You</AppText>
        <ToolList tools={YOU} />
      </View>
    </Screen>
  );
}

function ToolList({ tools }: { tools: Tool[] }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return <View style={styles.list}>
    {tools.map((t, i) => (
      <Pressable key={t.title} onPress={() => router.push(t.href)} accessibilityRole="button" accessibilityLabel={`${t.title}. ${t.body}`}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}>
        <View style={[styles.rowInner, i > 0 && styles.rowDivider]}>
          <View style={{ flex: 1, gap: 1 }}>
            <AppText variant="bodyStrong">{t.title}</AppText>
            <AppText variant="caption" muted>{t.body}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      </Pressable>
    ))}
  </View>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  stage: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 },
  member: { flex: 1, alignItems: 'center', minHeight: 48 },
  figure: { height: 108, justifyContent: 'flex-end' },
  figureQuiet: { opacity: 0.55 },
  name: { marginTop: 4 },
  nameQuiet: { color: c.textMuted },
  bubble: { marginTop: 14, backgroundColor: c.surface, borderRadius: radii.lg, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, gap: 12, ...t.shadow.card },
  bubbleTail: { position: 'absolute', top: -7, width: 16, height: 16, marginLeft: -8, backgroundColor: c.surface, transform: [{ rotate: '45deg' }], borderRadius: 3 },
  quote: { fontFamily: 'FrauncesItalic', fontSize: 21, lineHeight: 28, color: c.text },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  section: { marginTop: 34 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionTitle: { fontSize: 22 },
  youTitle: { marginBottom: 10 },
  list: { backgroundColor: c.surface, borderRadius: radii.lg, overflow: 'hidden', ...(t.dark ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border } : {}) },
  row: { paddingLeft: 18 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingVertical: 10, paddingRight: 16 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
});
