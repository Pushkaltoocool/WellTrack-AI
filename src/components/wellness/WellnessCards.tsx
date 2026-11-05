import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconBadge, Pill, type IconName } from '@/components/ui/misc';
import { SourceTag } from '@/components/ui/SourceTag';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { spacing, type Palette } from '@/theme/tokens';
import type { GoalCategory, GoalWithProgress, RecommendationAction, StoredRecommendation } from '@/types/domain';

/** `tone` is a palette key — resolve it with `useTheme().colors[meta.tone]`. */
export const CATEGORY_META: Record<GoalCategory, { icon: IconName; tone: keyof Palette; label: string }> = {
  sleep: { icon: 'moon-outline', tone: 'violet', label: 'Sleep' },
  movement: { icon: 'walk-outline', tone: 'cyan', label: 'Movement' },
  study: { icon: 'book-outline', tone: 'primary', label: 'Study' },
  stress: { icon: 'leaf-outline', tone: 'teal', label: 'Stress' },
  social: { icon: 'people-outline', tone: 'amber', label: 'Social' },
  screen: { icon: 'phone-portrait-outline', tone: 'rose', label: 'Screen time' },
  general: { icon: 'sparkles-outline', tone: 'primary', label: 'General' },
};

const STATUS_LABEL: Record<StoredRecommendation['status'], { label: string; tone: keyof Palette }> = {
  new: { label: 'New', tone: 'cyan' },
  accepted: { label: 'Goal set', tone: 'teal' },
  completed: { label: 'Done', tone: 'teal' },
  dismissed: { label: 'Dismissed', tone: 'textMuted' },
};

export function RecommendationCard({
  rec,
  onGoal,
  onStatus,
  compact,
}: {
  rec: StoredRecommendation;
  onGoal?: (rec: StoredRecommendation, action: RecommendationAction) => void;
  onStatus?: (rec: StoredRecommendation, status: StoredRecommendation['status']) => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const meta = CATEGORY_META[rec.category] ?? CATEGORY_META.general;
  const metaColor = colors[meta.tone];
  const status = STATUS_LABEL[rec.status];
  const dimmed = rec.status === 'dismissed';
  return (
    <Card accent={metaColor} style={dimmed ? { opacity: 0.6 } : undefined}>
      <View style={styles.recHead}>
        <IconBadge icon={meta.icon} color={metaColor} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading" style={{ fontSize: 22, lineHeight: 28 }}>{rec.title}</AppText>
          <AppText variant="caption" muted>
            {meta.label}
          </AppText>
        </View>
        {rec.status !== 'new' ? <Pill label={status.label} color={colors[status.tone]} /> : null}
      </View>
      {!compact ? (
        <AppText variant="caption" secondary style={{ marginTop: spacing.sm }}>
          {rec.body}
        </AppText>
      ) : null}
      <View style={styles.evidence}>
        <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
        <AppText variant="caption" muted style={{ flex: 1 }}>
          {rec.evidence}
        </AppText>
      </View>
      {!compact ? (
        <>
          <View style={{ marginTop: spacing.sm }}>
            <SourceTag source="rule" label="Rule-based suggestion" />
          </View>
          {rec.actions.length > 0 || onStatus ? (
            <View style={styles.actions}>
              {rec.actions.map((a) =>
                a.kind === 'goal' ? (
                  <Button
                    key={a.label}
                    small
                    variant="secondary"
                    icon="flag-outline"
                    label={a.label}
                    onPress={() => onGoal?.(rec, a)}
                    disabled={rec.status === 'dismissed'}
                  />
                ) : (
                  <Button
                    key={a.label}
                    small
                    variant="secondary"
                    icon="arrow-forward"
                    label={a.label}
                    onPress={() => a.route && router.push(a.route as Href)}
                  />
                ),
              )}
              {onStatus && rec.status !== 'completed' && rec.status !== 'dismissed' ? (
                <Button small variant="ghost" icon="checkmark-done-outline" label="Done" onPress={() => onStatus(rec, 'completed')} />
              ) : null}
              {onStatus && rec.status === 'new' ? (
                <Button small variant="ghost" icon="close" label="Dismiss" onPress={() => onStatus(rec, 'dismissed')} />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export function GoalRow({
  goal,
  onToggle,
  onLongPress,
}: {
  goal: GoalWithProgress;
  onToggle: (g: GoalWithProgress) => void;
  onLongPress?: (g: GoalWithProgress) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const meta = CATEGORY_META[goal.category] ?? CATEGORY_META.general;
  return (
    <Pressable
      onPress={() => onToggle(goal)}
      onLongPress={() => onLongPress?.(goal)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: goal.completedToday }}
      accessibilityLabel={`${goal.title}. ${goal.completedToday ? 'Completed today' : 'Not completed today'}`}
      accessibilityHint="Tap to toggle today's completion. Long-press for more options."
      style={({ pressed }) => [styles.goal, pressed && { opacity: 0.8 }]}>
      <IconBadge icon={meta.icon} color={colors[meta.tone]} size={34} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" style={goal.completedToday ? styles.done : undefined}>
          {goal.title}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          {goal.completionsLast7}/7 days this week{goal.streak > 1 ? ` · ${goal.streak}-day streak` : ''}
        </AppText>
      </View>
      <Ionicons
        name={goal.completedToday ? 'checkmark-circle' : 'ellipse-outline'}
        size={28}
        color={goal.completedToday ? colors.teal : colors.textMuted}
      />
    </Pressable>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  recHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.xs },
  evidence: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: c.bgElevated,
    padding: spacing.sm,
    borderRadius: 10,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  goal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: c.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    minHeight: 64,
  },
  done: { textDecorationLine: 'line-through', color: c.textSecondary },
});
