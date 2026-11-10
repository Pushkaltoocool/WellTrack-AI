import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Notice, ProgressBar } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { loadInsights } from '@/features/insights/insightsService';
import type { Pattern } from '@/features/insights/patterns';
import type { PersonalModel } from '@/features/insights/personalModel';
import type { WeeklyRecap } from '@/features/insights/weeklyRecap';
import { formatDayMonth, todayKey } from '@/lib/dates';
import { AI_ENABLED } from '@/services/ai/llm';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { useTheme } from '@/theme/ThemeProvider';

export default function InsightsScreen() {
  const { prefs } = useData();
  const today = todayKey();
  const { data, error, reload, loading } = useDbQuery((d) => loadInsights(d, prefs, today), [today, prefs]);
  return (
    <Screen back title="Insights" subtitle="What your own check-ins show over time." onRefresh={reload} refreshing={loading && !!data}>
      <View style={styles.stack}>
        {error ? <Notice tone="danger" title="Could not load insights">{error}</Notice> : null}
        {data ? (
          <>
            <RecapCard recap={data.recap} />
            <PatternsCard patterns={data.patterns.patterns} enough={data.patterns.enoughData} needed={data.patterns.daysNeeded} />
            <ModelCard model={data.model} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

function RecapCard({ recap }: { recap: WeeklyRecap }) {
  const { colors } = useTheme();
  const trendText = (t: WeeklyRecap['moodTrend'], good: 'up' | 'down') =>
    t === null ? null : t === 'flat' ? 'about the same as last week' : t === good ? 'better than last week' : 'harder than last week';
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <View style={styles.rowBetween}>
          <AppText variant="caption" secondary>{`Your week · ${formatDayMonth(recap.from)} – ${formatDayMonth(recap.to)}`}</AppText>
          <SourceTag source="self-reported" label="From your entries" />
        </View>
        {recap.checkInDays === 0 && recap.trackedSessions === 0 && !recap.stepDays ? (
          <AppText secondary>Nothing logged this week yet. Your recap appears after your first check-in.</AppText>
        ) : (
          <>
            <View style={styles.metrics}>
              <Metric value={`${recap.checkInDays}/7`} label="check-ins" />
              <Metric value={recap.avgMood === null ? '—' : recap.avgMood.toFixed(1)} label="avg mood" />
              <Metric value={recap.avgSleep === null ? '—' : `${recap.avgSleep.toFixed(1)}h`} label="avg sleep" />
              <Metric value={String(recap.goalCompletions)} label="goals done" />
            </View>
            {recap.highlights.map((h) => (
              <View key={h} style={styles.bulletRow}>
                <Ionicons name="sparkles-outline" size={16} color={colors.teal} style={{ marginTop: 3 }} />
                <AppText variant="caption" secondary style={{ flex: 1 }}>{h}</AppText>
              </View>
            ))}
            {trendText(recap.moodTrend, 'up') ? <AppText variant="caption" muted>{`Mood: ${trendText(recap.moodTrend, 'up')}. Stress: ${trendText(recap.stressTrend, 'down') ?? 'not enough data'}.`}</AppText> : null}
          </>
        )}
        {AI_ENABLED && recap.checkInDays > 0 ? (
          <Button label="Reflect on my week with Wren" icon="chatbubble-ellipses-outline" small variant="secondary" onPress={() => router.push('/coach?prompt=weekly')} />
        ) : null}
      </View>
    </Card>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <AppText variant="heading" style={{ fontSize: 22 }}>{value}</AppText>
      <AppText variant="caption" muted>{label}</AppText>
    </View>
  );
}

function PatternsCard({ patterns, enough, needed }: { patterns: Pattern[]; enough: boolean; needed: number }) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <AppText variant="heading">Patterns in your days</AppText>
        {!enough ? (
          <EmptyState compact icon="analytics-outline" title="Still learning your rhythm" body={`Check in on ${needed} more day${needed === 1 ? '' : 's'} and Wren will look for links between your habits, mood and stress.`} />
        ) : patterns.length === 0 ? (
          <AppText secondary>No clear patterns yet. Your days look fairly similar, or the differences are too small to call. Keep checking in.</AppText>
        ) : (
          patterns.map((p) => (
            <View key={p.id} style={styles.pattern}>
              <Ionicons name={p.favourable ? 'trending-up' : 'trending-down'} size={20} color={p.favourable ? colors.teal : colors.amber} />
              <AppText variant="caption" style={{ flex: 1 }}>{p.text}</AppText>
            </View>
          ))
        )}
        <AppText variant="caption" muted>Patterns show what tends to happen together in your own data. They don’t prove one thing causes another.</AppText>
      </View>
    </Card>
  );
}

function ModelCard({ model }: { model: PersonalModel }) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <View style={styles.rowBetween}>
          <AppText variant="heading">Your stress model</AppText>
          <SourceTag source="personal" />
        </View>
        <AppText variant="caption" secondary>
          A small model trained only on your check-ins, on this phone. It learns which of your habits go with higher or lower stress.
        </AppText>
        {model.status === 'insufficient' ? (
          <>
            <ProgressBar value={model.n / model.minN} color={colors.teal} height={6} />
            <AppText variant="caption" muted>{`${model.n} of ${model.minN} check-ins. It starts learning once it has a month of your days.`}</AppText>
          </>
        ) : model.status === 'not-better' ? (
          <Notice tone="info" title="Not reliable yet">
            {`On ${model.n} days, your habits don’t predict your stress better than simply guessing your average. Wren won’t show a model it can’t trust. It will check again as you log more.`}
          </Notice>
        ) : (
          <>
            <AppText variant="caption">
              {`Tested on each of your ${model.n} days in turn, it was off by ${model.mae!.toFixed(2)} points on average, versus ${model.baselineMae!.toFixed(2)} for guessing your average (${Math.round((model.improvement ?? 0) * 100)}% better).`}
            </AppText>
            <AppText variant="bodyStrong">What goes with your stress</AppText>
            {model.drivers.slice(0, 5).map((d) => (
              <View key={d.feature} style={{ gap: 4 }}>
                <View style={styles.rowBetween}>
                  <AppText variant="caption">{d.label}</AppText>
                  <AppText variant="caption" color={d.direction === 'lowers' ? colors.teal : colors.amber}>
                    {d.direction === 'lowers' ? 'more → lower stress' : 'more → higher stress'}
                  </AppText>
                </View>
                <ProgressBar value={Math.min(1, Math.abs(d.weight) / Math.max(...model.drivers.map((x) => Math.abs(x.weight))))} color={d.direction === 'lowers' ? colors.teal : colors.amber} height={5} />
              </View>
            ))}
            <AppText variant="caption" muted>{model.trainedOn ? `Trained on ${model.trainedOn.from} to ${model.trainedOn.to}. Associations, not causes.` : ''}</AppText>
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metrics: { flexDirection: 'row', gap: 8 },
  bulletRow: { flexDirection: 'row', gap: 10 },
  pattern: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 },
});
