import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, IconBadge, KeyValue, Notice, Pill, SectionHeader } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { RecommendationCard } from '@/components/wellness/WellnessCards';
import { addDays, todayKey } from '@/lib/dates';
import { useDbQuery } from '@/services/database/DataProvider';
import { listAssessments, listCheckIns, listRecommendations } from '@/services/database/repositories';
import { explainTreePath } from '@/services/ml/inference';
import { STRESS_MODEL, STRESS_RULE_SUMMARY, predictStress } from '@/services/ml/stressModel';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { spacing, type Palette } from '@/theme/tokens';
import type { RiskLevel } from '@/types/domain';

const MEANING: Record<RiskLevel, string> = {
  Low: 'In the training dataset, students with this study/sleep pattern were labelled Low stress.',
  Moderate: 'In the training dataset, students with this study/sleep pattern were labelled Moderate stress.',
  High: 'In the training dataset, students with this study/sleep pattern were labelled High stress.',
};

const FEATURE_LABEL: Record<string, string> = {
  Study_Hours_Per_Day: 'Study hours',
  Sleep_Hours_Per_Day: 'Sleep hours',
};

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export default function StressScreen() {
  const { colors, riskColors } = useTheme();
  const styles = useStyles(makeStyles);
  const today = todayKey();
  const { data } = useDbQuery(async (d) => {
    const checkIns = await listCheckIns(d, addDays(today, -13), today);
    const assessments = await listAssessments(d, addDays(today, -13));
    const recs = await listRecommendations(d, { dateKey: today });
    return { checkIns, assessments, recs };
  }, [today]);

  const latest = data?.checkIns[data.checkIns.length - 1] ?? null;
  const last7 = data?.checkIns.slice(-7) ?? [];
  const prediction = latest ? predictStress(latest) : null;
  const path = latest && prediction ? explainTreePath(STRESS_MODEL, prediction.inputs.map((i) => i.value)) : [];
  const stressRecs = (data?.recs ?? []).filter((r) => r.category === 'stress' || r.category === 'sleep' || r.category === 'study').slice(0, 3);

  if (data && !latest) {
    return (
      <Screen back title="Wellness & stress" subtitle="Check-in summary and experimental estimate">
        <Card>
          <EmptyState
            icon="create-outline"
            title="No check-ins yet"
            body="Complete a daily check-in to see your wellness summary. Nothing is estimated until you provide data."
            actionLabel="Start check-in"
            onAction={() => router.push('/checkin')}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen back title="Wellness & stress" subtitle="Check-in summary and experimental estimate">
      {latest ? (
        <>
          {/* Self-reported summary */}
          <Card gradient={['#123A44', '#0F1836']}>
            <View style={styles.rowBetween}>
              <AppText variant="heading">Wellness check-in summary</AppText>
              <SourceTag source="self-reported" />
            </View>
            <AppText variant="caption" muted style={{ marginTop: 2 }}>
              {latest.dateKey === today ? 'Today' : `Latest entry: ${latest.dateKey}`}
            </AppText>
            <View style={styles.bigRow}>
              <Metric label="Your stress rating" value={`${latest.stressLevel}/5`} color={latest.stressLevel >= 4 ? colors.rose : latest.stressLevel === 3 ? colors.amber : colors.teal} />
              <Metric label="Mood" value={`${latest.mood}/5`} color={colors.cyan} />
              <Metric label="Academic pressure" value={`${latest.academicPressure}/5`} color={colors.violet} />
            </View>
            <View style={styles.chips}>
              <Pill label={`Sleep ${latest.sleepHours} h`} color={colors.violet} icon="moon-outline" />
              <Pill label={`Study ${latest.studyHours} h`} color={colors.primary} icon="book-outline" />
              <Pill label={`Screen ${latest.screenTimeHours} h`} color={colors.rose} icon="phone-portrait-outline" />
              <Pill label={`Activity ${latest.physicalActivityMinutes} min`} color={colors.cyan} icon="walk-outline" />
              <Pill label={`Social ${latest.socialHours} h`} color={colors.amber} icon="people-outline" />
            </View>
            {last7.length > 1 ? (
              <AppText variant="caption" secondary style={{ marginTop: spacing.md }}>
                {`Average over your last ${last7.length} check-ins: stress ${avg(last7.map((c) => c.stressLevel))?.toFixed(1)}/5 · sleep ${avg(last7.map((c) => c.sleepHours))?.toFixed(1)} h · study ${avg(last7.map((c) => c.studyHours))?.toFixed(1)} h`}
              </AppText>
            ) : null}
            <Button
              label="Edit check-in"
              icon="create-outline"
              small
              variant="secondary"
              onPress={() => router.push(latest.dateKey === today ? '/checkin' : `/checkin?date=${latest.dateKey}`)}
              style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
            />
          </Card>

          {/* Experimental ML estimate */}
          <SectionHeader title="Stress-risk estimate" subtitle="Experimental — read the caveats below" />
          {prediction ? (
            <Card>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', flex: 1 }}>
                  <SourceTag source="ml" label="Trained model" />
                  <SourceTag source="experimental" />
                </View>
                <AppText variant="mono" color={colors.textMuted}>
                  {prediction.modelId}
                </AppText>
              </View>
              <View style={styles.predRow}>
                <IconBadge icon="flask-outline" color={riskColors[prediction.predicted]} size={52} />
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" muted>
                    Category from the dataset’s labelling
                  </AppText>
                  <AppText variant="title" color={riskColors[prediction.predicted]} testID="stress-category">
                    {prediction.predicted}
                  </AppText>
                </View>
              </View>
              <AppText variant="caption" secondary>
                {MEANING[prediction.predicted]} No confidence is shown: this model’s outputs are always 0% or 100% because its
                training labels follow a fixed rule, so a probability would be misleading.
              </AppText>

              <AppText variant="bodyStrong" style={{ marginTop: spacing.lg }}>
                Inputs used
              </AppText>
              {prediction.inputs.map((i) => (
                <KeyValue key={i.feature} k={i.label} v={`${i.value} ${i.unit}${i.outOfRange ? '  ⚠ outside trained range' : ''}`} />
              ))}
              <AppText variant="caption" muted style={{ marginTop: 4 }}>
                {`Model features: ${prediction.inputs.map((i) => i.feature).join(', ')} — copied from your check-in without transformation.`}
              </AppText>
              {prediction.anyOutOfRange ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Notice tone="warn">
                    {`At least one input is outside the 5–10 h range seen in training, so this estimate is an extrapolation.`}
                  </Notice>
                </View>
              ) : null}

              <AppText variant="bodyStrong" style={{ marginTop: spacing.lg }}>
                What decided it
              </AppText>
              {path.map((p, i) => (
                <View key={i} style={styles.pathRow}>
                  <Ionicons name="git-commit-outline" size={16} color={colors.violet} />
                  <AppText variant="caption" secondary style={{ flex: 1 }}>
                    {`${FEATURE_LABEL[p.feature] ?? p.feature} ${p.value} h is ${p.wentLeft ? '≤' : '>'} ${p.threshold.toFixed(2)} h`}
                  </AppText>
                </View>
              ))}
              <AppText variant="caption" muted style={{ marginTop: spacing.sm }}>
                {`Learned rule: ${STRESS_RULE_SUMMARY} These thresholds describe the dataset, not causes of stress, and are not clinical cut-offs.`}
              </AppText>
            </Card>
          ) : null}

          <SectionHeader title="Important limitations" />
          <Card>
            <Notice tone="warn" title="Why this is labelled experimental">
              {STRESS_MODEL.dataset.labelProvenance}
            </Notice>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {[
                'Only sleep and study hours affect this estimate. Your own stress rating, mood, academic pressure, screen time, social and physical activity do not.',
                'The model scored 100% on its test set only because the labels follow a fixed rule — this is not evidence that it measures real stress.',
                'Activity recognition (HAR) and this estimate are separate models trained on unrelated datasets; they are not combined.',
                'WellTrack is not a medical device and does not diagnose any condition. Your own sense of how you feel matters more than this category.',
              ].map((t) => (
                <View key={t} style={styles.pathRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.amber} />
                  <AppText variant="caption" secondary style={{ flex: 1 }}>
                    {t}
                  </AppText>
                </View>
              ))}
            </View>
            <AppText variant="caption" muted style={{ marginTop: spacing.md }}>
              {`Dataset: ${STRESS_MODEL.dataset.name} · ${STRESS_MODEL.dataset.samples} rows · licence ${STRESS_MODEL.dataset.license}`}
            </AppText>
          </Card>

          <SectionHeader title="Practical next steps" actionLabel="All suggestions" onAction={() => router.push('/wellness')} />
          <View style={{ gap: spacing.md }}>
            {stressRecs.map((r) => (
              <RecommendationCard key={r.id} rec={r} compact />
            ))}
            <View style={styles.actionsRow}>
              <Button label="Breathing" icon="leaf-outline" variant="secondary" small onPress={() => router.push('/breathing')} style={{ flex: 1 }} />
              <Button label="Focus timer" icon="timer-outline" variant="secondary" small onPress={() => router.push('/focus')} style={{ flex: 1 }} />
              <Button label="Support" icon="people-outline" variant="secondary" small onPress={() => router.push('/support')} style={{ flex: 1 }} />
            </View>
          </View>

          {data && data.assessments.length > 0 ? (
            <>
              <SectionHeader title="Recent estimates" subtitle="One per check-in day" />
              <Card padded={false}>
                {[...data.assessments].reverse().map((a) => {
                  const ci = data.checkIns.find((c) => c.dateKey === a.dateKey);
                  return (
                    <View key={a.id} style={styles.histRow}>
                      <AppText variant="caption" style={{ width: 92 }}>
                        {a.dateKey}
                      </AppText>
                      <View style={[styles.dot, { backgroundColor: riskColors[a.predicted] }]} />
                      <AppText variant="caption" color={riskColors[a.predicted]} style={{ flex: 1 }}>
                        {a.predicted}
                      </AppText>
                      <AppText variant="caption" muted>
                        {ci ? `self-rated ${ci.stressLevel}/5` : ''}
                      </AppText>
                    </View>
                  );
                })}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <AppText variant="metric" color={color}>
        {value}
      </AppText>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  bigRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  predRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginVertical: spacing.lg },
  pathRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 6 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
