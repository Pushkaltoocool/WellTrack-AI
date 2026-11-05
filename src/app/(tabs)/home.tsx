import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { ComposeFab } from '@/components/journal/ComposeFab';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice, SectionTitle } from '@/components/ui/misc';
import { MOOD_NAMES, Owl } from '@/components/ui/Owl';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { CATEGORY_META, GoalRow } from '@/components/wellness/WellnessCards';
import { activityLabel } from '@/features/activity/activityMeta';
import { STEP_HISTORY_SUPPORTED, requestStepHistoryPermission, syncStepHistory } from '@/features/activity/stepHistory';
import { useTracker } from '@/features/activity/TrackerProvider';
import { totalsFor } from '@/features/analytics/aggregations';
import { countdown } from '@/features/exams/examMeta';
import { loadJournal } from '@/features/journal/journalService';
import { morePrompts, promptForDay } from '@/features/journal/prompts';
import { onThisDay } from '@/features/journal/recall';
import { LETTER_MIN_DAYS } from '@/features/journal/weekLetter';
import { refreshRecommendations } from '@/features/wellness/wellnessService';
import { addDays, daysBetween, formatLongDate, formatMinutes, greeting, parseDateKey, todayKey } from '@/lib/dates';
import { dayStreak, weekOf } from '@/lib/streak';
import { AI_ENABLED } from '@/services/ai/llm';
import { useAccount } from '@/services/cloud/AccountProvider';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { getCheckIn, latestAssessment, listCheckIns, listDailySteps, listExams, listGoals, listJournalEntries, listRecommendations, listSessions, setGoalCompleted, setRecommendationStatus } from '@/services/database/repositories';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { dawn, moodColors, radii, skyFor, type Palette } from '@/theme/tokens';

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function Home() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, invalidate, updatePrefs } = useData();
  const { user } = useAccount();
  const { snap } = useTracker();
  const today = todayKey();
  const week = weekOf(today);
  const { data, loading, reload, error } = useDbQuery(async (d) => {
    await refreshRecommendations(d, prefs);
    const stepStatus = await syncStepHistory(d, prefs.stepHistoryEnabled);
    const since = addDays(today, -120);
    const [checkIn, sessions, assessment, recs, goals, daySteps, exams, recentCheckIns, journal, olderJournal] = await Promise.all([
      getCheckIn(d, today), listSessions(d, { source: 'live', fromKey: today }), latestAssessment(d),
      listRecommendations(d, { dateKey: today }), listGoals(d, 'active'), listDailySteps(d, today, today), listExams(d, today),
      listCheckIns(d, since, today), listJournalEntries(d, since, today), loadJournal(d, addDays(today, -366), addDays(today, -7)),
    ]);
    const moodByDay = new Map(recentCheckIns.map((c) => [c.dateKey, c.mood]));
    const journalDays = new Set(journal.map((j) => j.dateKey));
    return {
      checkIn, nextExam: exams[0] ?? null, totals: totalsFor(sessions.filter((s) => s.dateKey === today)), assessment, recs, goals, stepStatus,
      allDaySteps: prefs.stepHistoryEnabled ? (daySteps[0]?.steps ?? null) : null, moodByDay, journalDays,
      journalToday: journal.filter((j) => j.dateKey === today).length,
      streak: dayStreak([...moodByDay.keys(), ...journalDays], today),
      lookback: onThisDay(olderJournal, today),
      // Sundays: offer the weekly letter once there's enough of the week to write about.
      letterReady: parseDateKey(today).getDay() === 0 && new Set([...moodByDay.keys(), ...journalDays].filter((k) => k > addDays(today, -7))).size >= LETTER_MIN_DAYS,
    };
  }, [today, prefs]);
  const checkIn = data?.checkIn;
  const totals = data?.totals;
  const tracking = snap.status === 'tracking' && snap.mode === 'live';
  const rec = data?.recs.find((r) => r.status === 'new' || r.status === 'accepted') ?? data?.recs.find((r) => r.status === 'completed');
  const routeAction = rec?.actions.find((a) => a.kind !== 'goal' && a.route);
  const meta = rec ? CATEGORY_META[rec.category] : CATEGORY_META.stress;
  const steps = stepsTile(data?.allDaySteps ?? null, totals?.steps ?? null, prefs.stepHistoryEnabled, data?.stepStatus);
  const liveOn = snap.mode === 'live' && snap.status !== 'idle';
  const liveActive = liveOn ? snap.durations.WALKING + snap.durations.WALKING_UPSTAIRS + snap.durations.WALKING_DOWNSTAIRS : 0;
  const active = (totals?.activeSeconds ?? 0) + liveActive;
  const hasMovement = (totals?.trackedSeconds ?? 0) + (liveOn ? snap.trackedSeconds : 0) > 0;
  const [promptShift, setPromptShift] = useState(0);
  const prompt = promptShift ? morePrompts(today, 12)[(promptShift - 1) % 12] : promptForDay(today);
  const name = prefs.displayName.trim();
  const hour = new Date().getHours();
  const sky = skyFor(hour);
  const night = hour < 5 || hour >= 21;
  const streak = data?.streak ?? 0;
  const journalToday = data?.journalToday ?? 0;
  const enableStepHistory = async () => {
    if (await requestStepHistoryPermission()) await updatePrefs({ stepHistoryEnabled: true });
    else Alert.alert('Motion & Fitness access needed', 'Allow step access in Settings → Privacy & Security → Motion & Fitness.', [
      { text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]);
  };
  const openEntry = (id: number) => router.push({ pathname: '/entry', params: { id: String(id) } });
  const initial = (prefs.displayName.trim() || user?.displayName || '').slice(0, 1).toUpperCase();
  return <View style={{ flex: 1 }}>
    <Screen onRefresh={reload} refreshing={loading && !!data} bottomInset={70}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="caption" muted>{formatLongDate()}</AppText>
          <AppText variant="display" accessibilityRole="header" style={{ fontSize: 32, lineHeight: 39 }}>{`${greeting()}${name ? `, ${name}` : ''}.`}</AppText>
        </View>
        <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Profile and settings" style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}>
          {initial ? <AppText variant="bodyStrong" color={colors.onInk}>{initial}</AppText> : <Ionicons name="person" size={20} color={colors.onInk} />}
        </Pressable>
      </View>

      <View style={styles.weekCard}>
        <View style={styles.weekHead}>
          <AppText variant="bodyStrong">This week</AppText>
          <View style={styles.streak} accessibilityLabel={`${streak} day streak`}>
            <Ionicons name="leaf" size={14} color={streak ? colors.teal : colors.textMuted} />
            <AppText variant="caption" color={streak ? colors.teal : colors.textMuted}>{streak ? `${streak}-day streak` : 'Start a streak'}</AppText>
          </View>
        </View>
        <View style={styles.beads} accessibilityLabel="Mood this week">
          {week.map((k) => {
            const isToday = k === today;
            const future = k > today;
            const mood = data?.moodByDay.get(k);
            const wrote = data?.journalDays.has(k);
            return <Pressable key={k} disabled={future} onPress={() => router.push(isToday ? '/checkin' : `/checkin?date=${k}`)} style={styles.beadCol}
              accessibilityRole="button" accessibilityLabel={`${parseDateKey(k).toDateString()}${mood ? `, mood ${MOOD_NAMES[mood - 1]}` : ', no check-in'}${wrote ? ', journal entry' : ''}`}>
              <View style={[styles.bead, mood ? { backgroundColor: moodColors[mood - 1], borderColor: moodColors[mood - 1] } : null, future && styles.beadFuture, isToday && styles.beadToday]}>
                {wrote ? <View style={[styles.pen, mood ? { backgroundColor: '#FFFFFF' } : null]} /> : null}
              </View>
              <AppText variant="micro" color={isToday ? colors.text : colors.textMuted}>{DAY_LETTERS[parseDateKey(k).getDay()]}</AppText>
            </Pressable>;
          })}
        </View>
      </View>

      {error ? <Notice tone="danger" title="Could not load your day">{`${error}. Pull down to retry.`}</Notice> : null}

      <View style={styles.sky}>
        <LinearGradient colors={sky} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.skyRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText variant="caption" color={night ? '#C9D2E6' : dawn.textSecondary}>{checkIn ? 'Checked in' : 'Daily check-in'}</AppText>
            <AppText variant="title" color={night ? '#FFFFFF' : dawn.text}>{checkIn ? `You’re feeling ${MOOD_NAMES[checkIn.mood - 1].toLowerCase()} today.` : 'How are you feeling?'}</AppText>
          </View>
          <Owl mood={checkIn?.mood ?? 4} pose={night ? 'calm' : 'idle'} size={96} />
        </View>
        {checkIn ? <Pressable onPress={() => router.push('/checkin')} accessibilityRole="button" style={styles.skyButton}>
          <AppText variant="bodyStrong" color={dawn.text}>Edit check-in</AppText>
          <Ionicons name="arrow-forward" size={18} color={dawn.text} />
        </Pressable> : <View style={styles.owlPicker} accessibilityRole="radiogroup" accessibilityLabel="Pick the owl that matches your mood">
          {MOOD_NAMES.map((n, i) => <Pressable key={n} onPress={() => router.push(`/checkin?mood=${i + 1}`)} accessibilityRole="radio" accessibilityLabel={n}
            style={({ pressed }) => [styles.owlChoice, pressed && { transform: [{ scale: 0.92 }] }]}>
            <Owl mood={i + 1} size={46} />
            <AppText variant="micro" color={night ? '#E3E8F3' : dawn.textSecondary}>{n}</AppText>
          </Pressable>)}
        </View>}
      </View>

      <View style={styles.page}>
        {[0, 1, 2, 3, 4].map((i) => <View key={i} style={[styles.rule, { top: 86 + i * 34 }]} />)}
        <View style={styles.margin} />
        <View style={{ gap: 10, paddingLeft: 18 }}>
          <View style={styles.pageHead}>
            <AppText variant="caption" muted>Today’s page</AppText>
            {journalToday ? <AppText variant="caption" color={colors.teal}>{`${journalToday} ${journalToday === 1 ? 'entry' : 'entries'} today`}</AppText> : null}
          </View>
          <AppText style={styles.prompt}>{prompt}</AppText>
          <View style={styles.pageActions}>
            <Button label={journalToday ? 'Write more' : 'Start writing'} icon="create-outline" small onPress={() => router.push({ pathname: '/entry', params: { prompt } })} />
            <Pressable onPress={() => setPromptShift((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Show another prompt" hitSlop={8} style={styles.shuffle}>
              <Ionicons name="shuffle" size={18} color={colors.primary} /><AppText variant="bodyStrong" color={colors.primary}>Another</AppText>
            </Pressable>
          </View>
        </View>
      </View>

      {data?.lookback.length ? <Card onPress={() => openEntry(data.lookback[0].entries[0].id)} accessibilityLabel={`${data.lookback[0].label}: open that entry`} style={styles.spaced}>
        <View style={styles.lookback}>
          <View style={styles.lookbackDate}>
            <AppText variant="micro" color={colors.peach}>{parseDateKey(data.lookback[0].dateKey).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</AppText>
            <AppText variant="heading" style={{ fontSize: 19, lineHeight: 22 }}>{parseDateKey(data.lookback[0].dateKey).getDate()}</AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="caption" secondary>{data.lookback[0].label}</AppText>
            <AppText style={{ fontFamily: 'FrauncesItalic', fontSize: 17, lineHeight: 24 }} numberOfLines={3}>{data.lookback[0].entries[0].prompt ?? excerpt(data.lookback[0].entries[0].plain)}</AppText>
            {data.lookback[0].entries[0].prompt ? <AppText variant="caption" secondary numberOfLines={2}>{excerpt(data.lookback[0].entries[0].plain)}</AppText> : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
      </Card> : null}

      {data?.letterReady ? <Card onPress={() => router.push('/letter')} accessibilityLabel="Read Wren’s letter about your week" style={styles.spaced}>
        <View style={[styles.recRow, { alignItems: 'center' }]}>
          <View style={styles.letterIcon}><Ionicons name="mail-open-outline" size={22} color={colors.teal} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong" style={{ fontSize: 18 }}>Your week, from Wren</AppText>
            <AppText variant="caption" secondary>A short letter about the last seven days.</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
      </Card> : null}

      <SectionTitle title="For you" action="See all" onAction={() => router.push('/wellness')} />
      <Card>
        <View style={{ gap: 14 }}>
          <View style={styles.recRow}>
            <View style={styles.recIcon}><Ionicons name={rec ? meta.icon : 'leaf-outline'} size={22} color={colors.text} /></View>
            <View style={{ flex: 1, gap: 4 }}><AppText variant="bodyStrong" style={{ fontSize: 18 }}>{rec?.title ?? 'Two minutes of slow breathing'}</AppText>
              <AppText variant="caption" secondary>{rec?.evidence ?? 'A gentle way to begin. Suggestions get more personal after your first check-in.'}</AppText>
            </View>
          </View>
          <View style={styles.actions}>
            <Button label={routeAction?.label ?? (rec ? 'View suggestion' : 'Start breathing')} small
              onPress={() => router.push((routeAction?.route ?? (rec ? '/wellness' : '/breathing')) as Href)} />
            {rec ? <Button label={rec.status === 'completed' ? 'Done' : 'Mark as done'} icon="checkmark" small variant="secondary"
              onPress={async () => { try { await setRecommendationStatus(db, rec.id, rec.status === 'completed' ? 'new' : 'completed'); invalidate(); } catch { Alert.alert('Could not update suggestion', 'Please try again.'); } }} /> : null}
          </View>
        </View>
      </Card>

      <View style={[styles.pair, { marginTop: 16 }]}>
        <Card style={{ flex: 1 }} onPress={() => router.push('/activity')} accessibilityLabel="Movement">
          <View style={{ gap: 6 }}>
            <View style={styles.tileHead}><Ionicons name="walk-outline" size={18} color={colors.textSecondary} /><AppText variant="caption" secondary>Movement</AppText>{tracking ? <View style={styles.live} /> : null}</View>
            <AppText variant="metric">{hasMovement ? formatMinutes(active) : '—'}</AppText>
            <AppText variant="caption" muted numberOfLines={2}>{tracking && snap.current ? activityLabel(snap.current.label) : hasMovement ? 'active, while tracked' : 'Tap to start tracking'}</AppText>
          </View>
        </Card>
        <Card style={{ flex: 1 }} onPress={steps.action ? () => (steps.action === 'enable' ? void enableStepHistory() : void Linking.openSettings()) : undefined} accessibilityLabel={steps.label}>
          <View style={{ gap: 6 }}>
            <View style={styles.tileHead}><Ionicons name="footsteps-outline" size={18} color={colors.textSecondary} /><AppText variant="caption" secondary>{steps.label}</AppText></View>
            <AppText variant="metric">{steps.value === null ? '—' : steps.value.toLocaleString()}</AppText>
            {steps.action ? <AppText variant="caption" color={colors.primary} numberOfLines={2}>{steps.action === 'enable' ? 'Show all-day steps' : 'Open Settings'}</AppText>
              : <AppText variant="caption" muted numberOfLines={2}>{steps.caption}</AppText>}
          </View>
        </Card>
      </View>

      {data?.nextExam && daysBetween(today, data.nextExam.dateKey) <= 14 ? <Card onPress={() => router.push('/exams')} accessibilityLabel="Exams and deadlines" style={styles.spaced}>
        <View style={styles.recRow}>
          <View style={styles.recIcon}><Ionicons name="school-outline" size={22} color={colors.amber} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="caption" color={colors.amber}>{countdown(data.nextExam.dateKey, today)}</AppText>
            <AppText variant="bodyStrong">{data.nextExam.title}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
      </Card> : null}
      {AI_ENABLED ? <Card onPress={() => router.navigate('/coach')} accessibilityLabel="Talk to Wren, your AI coach" style={styles.spaced}>
        <View style={[styles.recRow, { alignItems: 'center' }]}>
          <Owl mood={checkIn?.mood ?? 4} pose="idle" size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong" style={{ fontSize: 18 }}>Talk it through with Wren</AppText>
            <AppText variant="caption" secondary>Plan tonight, prepare for an exam or reflect on your week.</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
      </Card> : null}
      {data?.assessment ? <Card onPress={() => router.push('/stress')} accessibilityLabel="Stress estimate" style={styles.spaced}>
        <View style={[styles.recRow, { alignItems: 'center' }]}>
          <View style={styles.recIcon}><Ionicons name="pulse-outline" size={22} color={colors.text} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="caption" secondary>{data.assessment.dateKey === today ? 'Stress estimate · today' : `Stress estimate · ${data.assessment.dateKey}`}</AppText>
            <AppText variant="bodyStrong">{`${data.assessment.predicted} risk`}</AppText>
          </View>
          <SourceTag source="experimental" label="Experimental" />
        </View>
      </Card> : null}
      {data?.goals.length ? <>
        <SectionTitle title="Today’s small actions" />
        <View style={{ gap: 10 }}>
          {data.goals.slice(0, 3).map((g) => <GoalRow key={g.id} goal={g} onToggle={async (goal) => { await setGoalCompleted(db, goal.id, today, !goal.completedToday); invalidate(); }} />)}
        </View>
      </> : null}
    </Screen>
    <ComposeFab />
  </View>;
}

const cardEdge = (c: Palette, t: Theme) => (t.dark ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border } : {});

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 4, ...t.shadow.card },
  weekCard: { backgroundColor: c.surface, borderRadius: radii.lg, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, marginBottom: 14, ...t.shadow.card, ...cardEdge(c, t) },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.tealSoft },
  beads: { flexDirection: 'row', justifyContent: 'space-between' },
  beadCol: { alignItems: 'center', gap: 6, minWidth: 40, minHeight: 48 },
  bead: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  beadFuture: { borderStyle: 'dashed', borderColor: c.border },
  beadToday: { transform: [{ scale: 1.12 }], borderColor: c.ink },
  pen: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.ink },
  sky: { borderRadius: radii.xl, padding: 22, overflow: 'hidden', gap: 18, ...t.shadow.card },
  skyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skyButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 46, paddingHorizontal: 18, borderRadius: 999, backgroundColor: 'rgba(255,253,249,0.92)' },
  owlPicker: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(255,253,249,0.55)', borderRadius: 22, paddingVertical: 8, paddingHorizontal: 4 },
  owlChoice: { alignItems: 'center', gap: 2, minWidth: 52, minHeight: 64 },
  page: { marginTop: 14, backgroundColor: c.surface, borderRadius: radii.lg, padding: 20, paddingBottom: 22, overflow: 'hidden', ...t.shadow.card, ...cardEdge(c, t) },
  rule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: c.rule },
  margin: { position: 'absolute', top: 0, bottom: 0, left: 26, width: 1.5, backgroundColor: t.dark ? '#5C4450' : '#F2C3AE' },
  pageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  prompt: { fontFamily: 'FrauncesItalic', fontSize: 23, lineHeight: 34, color: c.text },
  pageActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  shuffle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  pair: { flexDirection: 'row', gap: 12 },
  spaced: { marginTop: 16 },
  recRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  recIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  live: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.teal },
  lookback: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  lookbackDate: { width: 46, height: 46, borderRadius: 14, backgroundColor: c.peachSoft, alignItems: 'center', justifyContent: 'center' },
  letterIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.tealSoft, justifyContent: 'center', alignItems: 'center' }
});

function excerpt(plain: string): string {
  const flat = plain.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat;
}

/** Picks what the Steps tile shows: iPhone all-day history when enabled, else tracked-session steps. */
function stepsTile(
  allDay: number | null,
  sessionSteps: number | null,
  historyEnabled: boolean,
  status: string | undefined,
): { label: string; value: number | null; caption: string; action?: 'enable' | 'settings' } {
  if (STEP_HISTORY_SUPPORTED && historyEnabled) {
    if (status === 'denied') {
      return { label: 'Steps', value: sessionSteps, caption: 'Motion & Fitness access is off. Tap to open Settings', action: 'settings' };
    }
    if (allDay !== null) return { label: 'Steps today', value: allDay, caption: 'All day, from your iPhone’s motion sensor' };
  }
  const caption = sessionSteps !== null ? 'Pedometer, during tracked sessions only' : 'Pedometer data not available yet';
  if (STEP_HISTORY_SUPPORTED && !historyEnabled) {
    return { label: 'Steps', value: sessionSteps, caption: 'Tap to show all-day steps from your iPhone', action: 'enable' };
  }
  return { label: 'Steps', value: sessionSteps, caption };
}
