import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, IconBadge, Notice, SectionHeader, Segmented, type IconName } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { CATEGORY_META, GoalRow, RecommendationCard } from '@/components/wellness/WellnessCards';
import { acceptRecommendationGoal, refreshRecommendations } from '@/features/wellness/wellnessService';
import { addDays, todayKey } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import {
  createGoal,
  deleteGoal,
  listGoals,
  listRecommendations,
  setGoalCompleted,
  setGoalStatus,
  setRecommendationStatus,
} from '@/services/database/repositories';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';
import type { GoalCategory, GoalWithProgress } from '@/types/domain';

const TOOLS: { route: '/focus' | '/breathing' | '/support'; title: string; body: string; icon: IconName; tone: keyof Palette }[] = [
  { route: '/focus', title: 'Break & focus timer', body: 'A pause, then a little structure', icon: 'timer-outline', tone: 'primary' },
  { route: '/breathing', title: 'Breathing', body: '2-minute paced breathing', icon: 'leaf-outline', tone: 'teal' },
  { route: '/support', title: 'Get support', body: 'People & services', icon: 'people-outline', tone: 'violet' },
];

const CUSTOM_CATEGORIES: GoalCategory[] = ['sleep', 'movement', 'study', 'stress', 'social', 'screen'];

export default function WellnessScreen() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, invalidate } = useData();
  const today = todayKey();
  const [view, setView] = useState<'today' | 'history'>('today');
  const [newGoal, setNewGoal] = useState('');
  const [newCat, setNewCat] = useState<GoalCategory>('general');

  const { data, reload, loading, error } = useDbQuery(
    async (d) => {
      await refreshRecommendations(d, prefs);
      const [todayRecs, history, goals, archived] = await Promise.all([
        listRecommendations(d, { dateKey: today }),
        listRecommendations(d, { fromKey: addDays(today, -30) }),
        listGoals(d, 'active'),
        listGoals(d, 'archived'),
      ]);
      return { todayRecs, history: history.filter((r) => r.dateKey !== today), goals, archived };
    },
    [today, prefs],
  );

  const toggleGoal = async (g: GoalWithProgress) => {
    await setGoalCompleted(db, g.id, today, !g.completedToday);
    invalidate();
  };

  const goalMenu = (g: GoalWithProgress) =>
    Alert.alert(g.title, g.description || 'Goal options', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: g.status === 'active' ? 'Archive' : 'Reactivate',
        onPress: async () => {
          await setGoalStatus(db, g.id, g.status === 'active' ? 'archived' : 'active');
          invalidate();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteGoal(db, g.id);
          invalidate();
        },
      },
    ]);

  const addCustomGoal = async () => {
    const title = newGoal.trim();
    if (!title) return;
    await createGoal(db, { title: title.slice(0, 60), description: 'Custom goal', category: newCat });
    setNewGoal('');
    invalidate();
  };

  const completedToday = data?.goals.filter((g) => g.completedToday).length ?? 0;

  return (
    <Screen back title="Wellness support" subtitle="Turn insights into small, trackable habits" onRefresh={reload} refreshing={loading && !!data} bottomInset={8}>
      {error ? (
        <View style={{ marginBottom: spacing.md }}>
          <Notice tone="danger" title="Could not load data">{`${error} — pull down to retry.`}</Notice>
        </View>
      ) : null}
      <View style={styles.tools}>
        {TOOLS.map((t) => (
          <Pressable
            key={t.route}
            onPress={() => router.push(t.route)}
            style={({ pressed }) => [styles.tool, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={t.title}>
            <IconBadge icon={t.icon} color={colors[t.tone]} size={38} />
            <AppText variant="bodyStrong" numberOfLines={1}>
              {t.title}
            </AppText>
            <AppText variant="caption" muted numberOfLines={2}>
              {t.body}
            </AppText>
          </Pressable>
        ))}
      </View>

      <SectionHeader
        title="Active goals"
        subtitle={data?.goals.length ? `${completedToday} of ${data.goals.length} done today · tap to check off, long-press for options` : undefined}
      />
      {data && data.goals.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {data.goals.map((g) => (
            <GoalRow key={g.id} goal={g} onToggle={toggleGoal} onLongPress={goalMenu} />
          ))}
        </View>
      ) : (
        <Card>
          <EmptyState compact icon="flag-outline" title="No active goals" body="Accept a suggestion below, or add your own goal." />
        </Card>
      )}

      <Card style={{ marginTop: spacing.md }}>
        <AppText variant="bodyStrong">Add your own goal</AppText>
        <View style={styles.addRow}>
          <TextInput
            value={newGoal}
            onChangeText={setNewGoal}
            placeholder="e.g. Read for 20 minutes"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            maxLength={60}
            accessibilityLabel="New goal title"
            onSubmitEditing={addCustomGoal}
            returnKeyType="done"
          />
          <Button label="Add" icon="add" small onPress={addCustomGoal} disabled={!newGoal.trim()} />
        </View>
        <View style={styles.catRow}>
          {CUSTOM_CATEGORIES.map((c) => {
            const m = CATEGORY_META[c];
            const mc = colors[m.tone];
            const on = newCat === c;
            return (
              <Pressable
                key={c}
                onPress={() => setNewCat(on ? 'general' : c)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.cat, on && { borderColor: mc, backgroundColor: `${mc}22` }]}>
                <Ionicons name={m.icon} size={14} color={on ? mc : colors.textMuted} />
                <AppText variant="caption" color={on ? mc : colors.textMuted}>
                  {m.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionHeader title="Suggestions" />
      <Segmented
        options={[
          { value: 'today', label: 'Today' },
          { value: 'history', label: 'Previous (30 days)' },
        ]}
        value={view}
        onChange={setView}
      />
      <View style={{ gap: spacing.md, marginTop: spacing.md }}>
        {view === 'today' ? (
          <>
            <Notice tone="info" icon="git-branch-outline">
              Suggestions come from transparent rules applied to your own check-ins and tracked activity. They are not medical
              advice and can’t guarantee an outcome — try what feels useful.
            </Notice>
            {data?.todayRecs.map((r) => (
              <RecommendationCard
                key={r.id}
                rec={r}
                onGoal={async (rec, action) => {
                  await acceptRecommendationGoal(db, rec, action);
                  invalidate();
                }}
                onStatus={async (rec, status) => {
                  await setRecommendationStatus(db, rec.id, status);
                  invalidate();
                }}
              />
            ))}
          </>
        ) : data && data.history.length > 0 ? (
          data.history.map((r) => (
            <View key={r.id} style={{ gap: 4 }}>
              <AppText variant="micro" color={colors.textMuted}>
                {r.dateKey}
              </AppText>
              <RecommendationCard rec={r} compact />
            </View>
          ))
        ) : (
          <Card>
            <EmptyState compact icon="time-outline" title="No previous suggestions" body="Suggestions from earlier days will appear here." />
          </Card>
        )}
      </View>

      {data && data.archived.length > 0 ? (
        <>
          <SectionHeader title="Archived goals" subtitle="Long-press to reactivate or delete" />
          <View style={{ gap: spacing.sm, opacity: 0.75 }}>
            {data.archived.map((g) => (
              <GoalRow key={g.id} goal={g} onToggle={() => goalMenu(g)} onLongPress={goalMenu} />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  tools: { flexDirection: 'row', gap: spacing.sm },
  tool: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: 6,
    minHeight: 120,
  },
  addRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    color: c.text,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  cat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border,
    minHeight: 32,
  },
});
