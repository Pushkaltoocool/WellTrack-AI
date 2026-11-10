import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarChart } from '@/components/charts/Charts';
import { DotGrid, EmotionRings, Legend, MoodBreakdown, NoData, TrendLine, WordCloud, type DotCell } from '@/components/charts/TrendCharts';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Chips, Eyebrow, Notice, Segmented } from '@/components/ui/misc';
import { Owl } from '@/components/ui/Owl';
import { Screen } from '@/components/ui/Screen';
import { SourceTag, type DataSource } from '@/components/ui/SourceTag';
import { Glass } from '@/components/ui/Glass';
import { TAB_BAR_COLLAPSED, TAB_BAR_HEIGHT, tabBarBottom, useTabBarCollapsed } from '@/components/ui/tabBarState';
import { bucketize, mean, moodHeadline, periodFor, type Bucket, type Period, type PeriodKind } from '@/features/analytics/periods';
import { useHealthData, type DailyHealth } from '@/features/health';
import { emotionMeta } from '@/features/journal/analysis';
import { topEmotions, topWords, triggerSummary } from '@/features/journal/journalInsights';
import { emotionColor, loadJournal, toInsightEntries } from '@/features/journal/journalService';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { todayKey } from '@/lib/dates';
import { buildDayFeatures } from '@/features/research/dailyFeatures';
import { MIN_DAYS, stressVsActivity } from '@/features/research/stressSignals';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { ACTIVE_CLASSES } from '@/types/domain';
import { listCheckIns, listDailySteps, listPractices, listSessions } from '@/services/database/repositories';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { moodColors, radii, type Palette } from '@/theme/tokens';

const KIND_LABEL: Record<PeriodKind, string> = { week: 'Week', month: 'Month', year: 'Year' };
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const within = <T extends { dateKey: string }>(rows: T[], p: { from: string; to: string }) => rows.filter((r) => r.dateKey >= p.from && r.dateKey <= p.to);

export default function TrendsScreen() {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const { prefs, updatePrefs } = useData();
  const today = todayKey();
  const [kind, setKind] = useState<PeriodKind>('year');
  const [offset, setOffset] = useState(0);
  const p = periodFor(kind, offset, today);
  const prev = periodFor(kind, offset - 1, today);

  const { data, reload, loading, error } = useDbQuery(async (d) => {
    const [checkIns, journal, practices, steps, sessions] = await Promise.all([
      listCheckIns(d, prev.from, p.to), loadJournal(d, prev.from, p.to), listPractices(d, prev.from, p.to),
      listDailySteps(d, prev.from, p.to), listSessions(d, { source: 'live', fromKey: prev.from }),
    ]);
    return { checkIns, journal, practices, steps, sessions: sessions.filter((s) => s.dateKey <= p.to) };
  }, [prev.from, p.to]);
  const health = useHealthData(prev.from, p.to, prefs.healthKitEnabled);

  const cur = within(data?.checkIns ?? [], p);
  const old = within(data?.checkIns ?? [], prev);
  const moodOf = (rows: { mood: number }[]) => mean(rows.map((r) => r.mood));
  const avg = moodOf(cur);
  const prevAvg = moodOf(old);
  const series = bucketize(cur, p.buckets, moodOf);
  const prevSeries = bucketize(old, prev.buckets, moodOf);
  const trend = avg !== null && prevAvg !== null ? avg - prevAvg : null;
  const breakdown = (rows: { mood: number }[]) => [1, 2, 3, 4, 5].map((m) => rows.filter((r) => r.mood === m).length);

  const journal = toInsightEntries(within(data?.journal ?? [], p));
  const feelings = topEmotions(journal, 3);
  const triggers = triggerSummary(journal, 3);

  const yearLabel = (q: Period) => (q.kind === 'year' ? q.subtitle : q.title);
  const healthRows = within(health.rows, p);
  const connected = prefs.healthKitEnabled && health.availability === 'available';

  const changeKind = (k: PeriodKind) => { setKind(k); setOffset(0); };

  return <View style={{ flex: 1 }}>
    <Screen onRefresh={() => { reload(); health.reload(); }} refreshing={loading && !!data} bottomInset={80}>
      <View style={styles.top}>
        <AppText variant="display" accessibilityRole="header">Trends</AppText>
        <AppText secondary>What your check-ins, journal and habits add up to.</AppText>
      </View>
      <Segmented options={(['week', 'month', 'year'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} value={kind} onChange={changeKind} />
      {error ? <Notice tone="danger" title="Could not load trends">{error}</Notice> : null}

      <View style={styles.hero}>
        <Owl mood={avg === null ? 3 : Math.round(avg)} pose={avg === null ? 'calm' : 'idle'} size={92} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="caption" muted>{`Average mood · ${p.title.toLowerCase()}`}</AppText>
          {avg !== null ? <AppText variant="display" style={{ fontSize: 44, lineHeight: 50 }}>{avg.toFixed(1)}<AppText variant="heading" muted>{' / 5'}</AppText></AppText> : null}
          <AppText variant="heading">{moodHeadline(avg)}</AppText>
          {trend !== null && Math.abs(trend) >= 0.1 ? <View style={[styles.trendChip, { backgroundColor: trend > 0 ? colors.tealSoft : colors.peachSoft }]}>
            <Ionicons name={trend > 0 ? 'trending-up' : 'trending-down'} size={16} color={trend > 0 ? colors.teal : colors.amber} />
            <AppText variant="caption" color={trend > 0 ? colors.teal : colors.amber}>{`${trend > 0 ? '+' : ''}${trend.toFixed(1)} vs ${yearLabel(prev).toLowerCase()}`}</AppText>
          </View> : null}
          {avg === null ? <AppText secondary>Check in to see your mood take shape.</AppText> : null}
        </View>
      </View>
      <View style={styles.bleed}>
        <TrendLine values={series} previous={prevSeries} labels={p.buckets.map((b) => b.label)} currentIndex={p.currentBucket} average={avg} height={210} />
      </View>
      <Legend items={[{ color: colors.sky, label: yearLabel(p) }, { color: dark ? colors.borderStrong : '#D3D5D9', label: yearLabel(prev) }]} />

      <Eyebrow>Mood</Eyebrow>
      <TrendCard title="How your days felt" subtitle="Check-ins at each mood, compared with the period before">
        {cur.length || old.length ? <MoodBreakdown current={breakdown(cur)} previous={breakdown(old)} currentLabel={yearLabel(p)} previousLabel={yearLabel(prev)} />
          : <NoData body="Complete a daily check-in to see how your moods spread out." />}
      </TrendCard>
      <TrendCard title="Mood map" subtitle={kind === 'year' ? 'Colour is the month’s average mood; the fill shows how often you checked in' : 'The mood you logged on each day'}>
        <DotGrid cells={moodCells(p, cur)} columns={kind === 'year' ? 6 : 7} size={kind === 'month' ? 34 : 44} />
        <Pressable onPress={() => router.push('/insights')} accessibilityRole="button" style={styles.linkRow}>
          <AppText variant="bodyStrong" style={{ fontSize: 17 }}>Weekly recap & patterns</AppText>
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </Pressable>
      </TrendCard>

      <Eyebrow>Journal</Eyebrow>
      <TrendCard title="Feelings Wren noticed" subtitle={`Most frequent in your entries · ${p.title.toLowerCase()}`}>
        {feelings.length ? <EmotionRings items={feelings.map((f) => ({ label: emotionMeta(f.name).label, share: f.share, color: emotionColor(f.name) }))} />
          : <NoData body="Write in your journal and the feelings Wren notices will appear here." />}
      </TrendCard>
      <TrendCard title="What lifts you" subtitle="Named in your lighter entries">
        {triggers.shine.length ? <PhraseList items={triggers.shine} color={colors.sky} /> : <NoData body="Things that lift you, from your journal, show up here." />}
      </TrendCard>
      <TrendCard title="What weighs on you" subtitle="Named in your heavier entries">
        {triggers.down.length ? <PhraseList items={triggers.down} color={colors.rose} /> : <NoData body="Things that weigh on you, from your journal, show up here." />}
      </TrendCard>

      <Eyebrow>{Platform.OS === 'ios' ? 'Apple Health' : 'Health'}</Eyebrow>
      <HealthConnect availability={health.availability} enabled={prefs.healthKitEnabled} error={health.error}
        onConnect={async () => { if (await health.connect()) await updatePrefs({ healthKitEnabled: true }); }} />
      <SleepCard p={p} connected={connected} healthRows={healthRows} checkIns={cur} />
      <FitnessCard p={p} connected={connected} healthRows={healthRows} steps={within(data?.steps ?? [], p)} />
      <HealthMetricCard title="Mindful minutes" subtitle="Total per day, from Apple Health" p={p} connected={connected}
        values={bucketize(healthRows.filter((r) => r.mindfulMinutes !== null), p.buckets, (rs) => sum(rs.map((r) => r.mindfulMinutes ?? 0)))} unit="min" empty="You’ll see your mindful minutes trends from Apple Health." />
      <HealthMetricCard title="Daylight" subtitle="Average minutes outdoors in daylight, from Apple Health" p={p} connected={connected}
        values={bucketize(healthRows.filter((r) => r.daylightMinutes !== null), p.buckets, (rs) => mean(rs.map((r) => r.daylightMinutes ?? 0)))} unit="min" empty="You’ll see your time in daylight trends from Apple Health (iOS 17 or later)." />

      <Eyebrow>Habits</Eyebrow>
      <WritingCard p={p} entries={journal} />
      <PracticeCard title="Breathing" what="did breathing exercises" p={p} rows={within(data?.practices ?? [], p).filter((r) => r.kind === 'breathing')} action={() => router.push('/breathing')} />
      <PracticeCard title="Focus" what="completed focus blocks" p={p} rows={within(data?.practices ?? [], p).filter((r) => r.kind === 'focus')} action={() => router.push('/focus')} />
      <MovementCard p={p} sessions={within(data?.sessions ?? [], p)} />
      <StressMovementCard />
    </Screen>
    <PeriodNav period={p} onPrev={() => setOffset((o) => o - 1)} onNext={() => setOffset((o) => Math.min(0, o + 1))} canNext={offset < 0} />
  </View>;
}

function moodCells(p: Period, rows: { dateKey: string; mood: number }[]): DotCell[] {
  return p.buckets.map((b, i) => {
    const inside = rows.filter((r) => r.dateKey >= b.from && r.dateKey <= b.to);
    const label = p.kind === 'year' ? MONTH_SHORT[i] : p.kind === 'week' ? b.label : String(i + 1);
    if (!inside.length) return { label, kind: 'empty' as const };
    const avg = mean(inside.map((r) => r.mood)) ?? 3;
    const days = new Set(inside.map((r) => r.dateKey)).size;
    const span = p.kind === 'year' ? Number(b.to.slice(8)) : 1;
    return { label, kind: 'mood' as const, color: moodColors[Math.round(avg) - 1], scale: p.kind === 'year' ? Math.min(1, 0.3 + (days / span) * 1.4) : 0.62 };
  });
}

function checkCells(p: Period, has: (b: Bucket) => boolean): DotCell[] {
  return p.buckets.map((b, i) => {
    const label = p.kind === 'year' ? MONTH_SHORT[i] : p.kind === 'week' ? b.label : String(i + 1);
    return has(b) ? { label, kind: 'check' as const } : { label, kind: 'empty' as const };
  });
}

function TrendCard({ title, subtitle, chips, children }: { title: string; subtitle?: string; chips?: ReactNode; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return <View style={styles.card}>
    <AppText variant="title" style={{ fontSize: 25 }}>{title}</AppText>
    {subtitle ? <AppText secondary style={{ fontSize: 17, marginTop: 2 }}>{subtitle}</AppText> : null}
    {chips ? <View style={{ marginTop: 16 }}>{chips}</View> : null}
    <View style={{ marginTop: 18 }}>{children}</View>
  </View>;
}

function PhraseList({ items, color }: { items: { phrase: string; count: number }[]; color: string }) {
  return <View style={{ gap: 12 }}>
    {items.map((t) => <View key={t.phrase} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
      <AppText variant="bodyStrong" style={{ flex: 1, fontSize: 18 }}>{t.phrase}</AppText>
      <AppText muted>{`${t.count} ${t.count === 1 ? 'entry' : 'entries'}`}</AppText>
    </View>)}
  </View>;
}

function bars(p: Period, values: (number | null)[], color: string, format?: (v: number) => string) {
  return <BarChart data={values.map((v, i) => ({ label: p.buckets[i].label || ' ', segments: [{ value: v ?? 0, color }] }))} height={130} formatValue={format} />;
}

function HealthConnect({ availability, enabled, error, onConnect }: { availability: string; enabled: boolean; error: string | null; onConnect: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  if (availability === 'available' && enabled && !error) return null;
  const text = availability === 'available'
    ? (error ?? 'Connect Apple Health to bring in sleep, steps, active energy, mindful minutes and time in daylight. Read-only, and it stays on your phone.')
    : availability === 'expo-go' ? 'Apple Health connects in the full iPhone app (not in Expo Go). Until then, sleep comes from your check-ins and steps from the motion sensor.'
      : availability === 'unsupported-platform' ? 'Apple Health is iPhone-only. On Android, sleep comes from your check-ins and steps from the motion sensor while tracking.'
        : 'Apple Health isn’t available on this device.';
  return <View style={[styles.card, { flexDirection: 'row', gap: 14, alignItems: 'flex-start' }]}>
    <Ionicons name="heart-circle-outline" size={30} color={colors.rose} />
    <View style={{ flex: 1, gap: 10 }}>
      <AppText secondary>{text}</AppText>
      {availability === 'available' ? <Button label="Connect Apple Health" small onPress={onConnect} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  </View>;
}

function SleepCard({ p, connected, healthRows, checkIns }: { p: Period; connected: boolean; healthRows: DailyHealth[]; checkIns: { dateKey: string; sleepHours: number }[] }) {
  const { colors } = useTheme();
  const fromHealth = connected && healthRows.some((r) => r.asleepMinutes !== null);
  const values = fromHealth
    ? bucketize(healthRows.filter((r) => r.asleepMinutes !== null), p.buckets, (rs) => mean(rs.map((r) => (r.asleepMinutes ?? 0) / 60)))
    : bucketize(checkIns, p.buckets, (rs) => mean(rs.map((r) => r.sleepHours)));
  const avg = mean(values.filter((v): v is number => v !== null));
  const source: DataSource = fromHealth ? 'measured' : 'self-reported';
  return <TrendCard title="Sleep" subtitle={fromHealth ? 'Hours asleep, from Apple Health' : 'Hours of sleep you logged at check-in'}>
    {avg !== null ? <>
      <AppText variant="metric">{`${avg.toFixed(1)} h`}<AppText muted>{' average'}</AppText></AppText>
      <TrendLine values={values} labels={p.buckets.map((b) => b.label)} currentIndex={p.currentBucket} domain={[0, 12]} height={140} color={colors.violet} />
      <View style={{ marginTop: 10 }}><SourceTag source={source} label={fromHealth ? 'Apple Health' : undefined} /></View>
    </> : <NoData body="You’ll see your sleep trends here from Apple Health or your check-ins." />}
  </TrendCard>;
}

function FitnessCard({ p, connected, healthRows, steps }: { p: Period; connected: boolean; healthRows: DailyHealth[]; steps: { dateKey: string; steps: number }[] }) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'steps' | 'energy'>('steps');
  const healthSteps = connected && healthRows.some((r) => r.steps !== null);
  const stepValues = healthSteps
    ? bucketize(healthRows.filter((r) => r.steps !== null), p.buckets, (rs) => mean(rs.map((r) => r.steps ?? 0)))
    : bucketize(steps, p.buckets, (rs) => mean(rs.map((r) => r.steps)));
  const energy = bucketize(healthRows.filter((r) => r.activeEnergyKcal !== null), p.buckets, (rs) => mean(rs.map((r) => r.activeEnergyKcal ?? 0)));
  const values = tab === 'steps' ? stepValues : energy;
  const has = values.some((v) => v !== null);
  return <TrendCard title="Activity" subtitle={connected ? 'Daily averages from Apple Health' : 'Average steps per day'}
    chips={<Chips options={[{ value: 'steps', label: 'Steps' }, { value: 'energy', label: 'Active energy' }]} value={tab} onChange={setTab} />}>
    {has ? <>
      {bars(p, values, tab === 'steps' ? colors.teal : colors.amber, (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`))}
      <SourceTag source="measured" label={healthSteps || tab === 'energy' ? 'Apple Health' : 'Phone motion sensor'} />
    </> : <NoData body={tab === 'steps' ? 'You’ll see your step trends from Apple Health or your phone’s motion sensor.' : 'You’ll see calories burned from Apple Health.'} />}
  </TrendCard>;
}

function HealthMetricCard({ title, subtitle, p, connected, values, unit, empty }: { title: string; subtitle: string; p: Period; connected: boolean; values: (number | null)[]; unit: string; empty: string }) {
  const { colors } = useTheme();
  const has = connected && values.some((v) => v !== null);
  return <TrendCard title={title} subtitle={subtitle}>
    {has ? <>{bars(p, values, colors.cyan, (v) => `${Math.round(v)}`)}<AppText variant="caption" muted>{`Per day, in ${unit}`}</AppText></> : <NoData body={empty} />}
  </TrendCard>;
}

function WritingCard({ p, entries }: { p: Period; entries: { dateKey: string; text: string }[] }) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'when' | 'words' | 'cloud'>('when');
  const words = bucketize(entries, p.buckets, (rs) => sum(rs.map((r) => (r.text.trim() ? r.text.trim().split(/\s+/).length : 0))));
  const cloud = topWords(entries.map((e) => ({ ...e, analysis: null })), 24);
  return <TrendCard title="Journaling" subtitle="When you wrote, how much, and the words you reach for"
    chips={<Chips options={[{ value: 'when', label: 'Calendar' }, { value: 'words', label: 'Word count' }, { value: 'cloud', label: 'Your words' }]} value={tab} onChange={setTab} />}>
    {tab === 'when' ? <DotGrid cells={checkCells(p, (b) => entries.some((e) => e.dateKey >= b.from && e.dateKey <= b.to))} columns={p.kind === 'year' ? 6 : 7} size={p.kind === 'month' ? 34 : 44} />
      : tab === 'words' ? (words.some((v) => v) ? bars(p, words, colors.ink) : <NoData body="Your word counts appear after your first entry." />)
        : cloud.length ? <WordCloud words={cloud} /> : <NoData body="The words you use most will gather here." />}
  </TrendCard>;
}

function PracticeCard({ title, what, p, rows, action }: { title: string; what: string; p: Period; rows: { dateKey: string; seconds: number }[]; action: () => void }) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'when' | 'sessions' | 'duration'>('when');
  const sessions = bucketize(rows, p.buckets, (rs) => rs.length);
  const minutes = bucketize(rows, p.buckets, (rs) => sum(rs.map((r) => r.seconds)) / 60);
  return <TrendCard title={title} subtitle={`When you ${what}`}
    chips={<Chips options={[{ value: 'when', label: 'Calendar' }, { value: 'sessions', label: 'Sessions' }, { value: 'duration', label: 'Minutes' }]} value={tab} onChange={setTab} />}>
    {!rows.length ? <View style={{ gap: 12 }}>
      <DotGrid cells={checkCells(p, () => false)} columns={p.kind === 'year' ? 6 : 7} size={p.kind === 'month' ? 34 : 44} />
      <Button label={`Try ${title.toLowerCase()}`} small variant="secondary" onPress={action} style={{ alignSelf: 'center' }} />
    </View>
      : tab === 'when' ? <DotGrid cells={checkCells(p, (b) => rows.some((r) => r.dateKey >= b.from && r.dateKey <= b.to))} columns={p.kind === 'year' ? 6 : 7} size={p.kind === 'month' ? 34 : 44} />
        : tab === 'sessions' ? bars(p, sessions, colors.sky) : <>{bars(p, minutes, colors.sky, (v) => `${Math.round(v)}`)}<AppText variant="caption" muted>Minutes</AppText></>}
  </TrendCard>;
}

function MovementCard({ p, sessions }: { p: Period; sessions: { dateKey: string; durations: Record<string, number> }[] }) {
  const { colors } = useTheme();
  const active = bucketize(sessions, p.buckets, (rs) => sum(rs.map((r) => ACTIVE_CLASSES.reduce((a, k) => a + (r.durations[k] ?? 0), 0) / 60)));
  return <TrendCard title="Movement" subtitle="Active minutes recognised while tracking">
    {active.some((v) => v) ? <>{bars(p, active, colors.teal, (v) => `${Math.round(v)}`)}<SourceTag source="ml" label="ML-classified sensor data" /></>
      : <View style={{ gap: 12 }}><NoData body="Track a walk and your active minutes will appear here." /><Button label="Track movement" small variant="secondary" onPress={() => router.push('/activity')} style={{ alignSelf: 'center' }} /></View>}
  </TrendCard>;
}

/** Stress (check-ins) vs measured movement over the last 90 days — descriptive, not a prediction. */
function StressMovementCard() {
  const { colors } = useTheme();
  const { data } = useDbQuery((d) => buildDayFeatures(d, 90), []);
  const signal = stressVsActivity(data ?? []);
  return <TrendCard title="Stress & movement" subtitle="Your check-in stress compared with how much you moved that day">
    {signal.sentence ? <View style={{ gap: 10 }}>
      <AppText variant="bodyStrong" style={{ fontSize: 17 }}>{signal.sentence}</AppText>
      <AppText variant="caption" muted>{`Based on ${signal.days} days with both a check-in and measured movement. A pattern in your own days, not proof that one causes the other.`}</AppText>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><SourceTag source="self-reported" label="Your stress ratings" /><SourceTag source="measured" label="Measured movement" /></View>
    </View> : <View style={{ gap: 12 }}>
      <NoData body={`Check in on ${MIN_DAYS} days with all-day activity on, and Wren will show how your stress and movement line up. ${signal.days ? `${signal.days} so far.` : ''}`} />
      <Button label="Turn on all-day activity" small variant="secondary" onPress={() => router.push('/activity')} style={{ alignSelf: 'center' }} />
    </View>}
    <View style={{ marginTop: 12, height: 1, backgroundColor: colors.border }} />
  </TrendCard>;
}

/** Floating "‹ This year 2026 ›" control; slides beside the tab bar's collapsed button while scrolling. */
function PeriodNav({ period, onPrev, onNext, canNext }: { period: Period; onPrev: () => void; onNext: () => void; canNext: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const collapsed = useTabBarCollapsed('trends');
  const reduceMotion = useReducedMotion();
  const base = tabBarBottom(insets.bottom);
  // Above the bar; tucks in beside the collapsed pill while scrolling.
  const style = collapsed
    ? { left: 16 + TAB_BAR_COLLAPSED + 12, bottom: base + (TAB_BAR_HEIGHT - TAB_BAR_COLLAPSED) / 2, height: TAB_BAR_COLLAPSED }
    : { left: 16, bottom: base + TAB_BAR_HEIGHT + 10, height: 60 };
  return <Animated.View layout={reduceMotion ? undefined : LinearTransition.duration(180)} style={[styles.periodNavPos, style]}>
    <Glass style={styles.periodNav} fallbackStyle={styles.periodNavSolid} interactive>
    <Pressable onPress={onPrev} accessibilityRole="button" accessibilityLabel="Previous period" hitSlop={8} style={styles.navBtn}>
      <Ionicons name="chevron-back" size={24} color={colors.text} />
    </Pressable>
    <View style={{ flex: 1, alignItems: 'center' }} accessibilityLiveRegion="polite">
      <AppText variant="bodyStrong" style={{ fontSize: 18 }} numberOfLines={1}>{period.title}</AppText>
      <AppText variant="caption" muted numberOfLines={1}>{period.subtitle}</AppText>
    </View>
    <Pressable onPress={onNext} disabled={!canNext} accessibilityRole="button" accessibilityLabel="Next period" hitSlop={8} style={[styles.navBtn, !canNext && { opacity: 0.3 }]}>
      <Ionicons name="chevron-forward" size={24} color={colors.text} />
    </Pressable>
    </Glass>
  </Animated.View>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  top: { gap: 4, marginBottom: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 24, marginBottom: 12 },
  trendChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 6 },
  bleed: { marginHorizontal: -24 },
  card: { backgroundColor: c.surface, borderRadius: radii.lg, padding: 22, marginBottom: 16, ...t.shadow.card, borderWidth: t.dark ? StyleSheet.hairlineWidth : 0, borderColor: c.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minHeight: 48, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderStrong, paddingTop: 10 },
  periodNavPos: { position: 'absolute', right: 16, maxWidth: 520 },
  periodNav: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 8 },
  periodNavSolid: { backgroundColor: t.dark ? 'rgba(27,32,48,0.97)' : 'rgba(255,255,255,0.97)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong, ...t.shadow.float },
  navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
