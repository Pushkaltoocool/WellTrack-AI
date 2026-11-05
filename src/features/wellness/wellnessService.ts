/** Orchestrates writes that have downstream effects (assessments, recommendations). */
import { totalsFor } from '@/features/analytics/aggregations';
import { emotionMeta } from '@/features/journal/analysis';
import { heavyStretch } from '@/features/journal/journalInsights';
import { loadJournal, toInsightEntries } from '@/features/journal/journalService';
import { generateRecommendations } from '@/features/wellness/recommendationEngine';
import { addDays, todayKey } from '@/lib/dates';
import type { Db } from '@/services/database/db';
import {
  createGoal,
  listCheckIns,
  listExams,
  listSessions,
  saveAssessment,
  syncRecommendations,
  upsertCheckIn,
  setRecommendationStatus,
} from '@/services/database/repositories';
import { predictStress } from '@/services/ml/stressModel';
import type { CheckIn, CheckInInput, Preferences, RecommendationAction, StoredRecommendation } from '@/types/domain';

export async function refreshRecommendations(db: Db, prefs: Preferences): Promise<void> {
  const today = todayKey();
  const checkIns = await listCheckIns(db, addDays(today, -13), today);
  const sessions = await listSessions(db, { source: 'live', fromKey: today });
  const t = totalsFor(sessions.filter((s) => s.dateKey === today));
  const exams = await listExams(db, today);
  const heavy = heavyStretch(toInsightEntries(await loadJournal(db, addDays(today, -6), today)), today);
  const recs = generateRecommendations({
    todayKey: today,
    checkIns,
    todayActivity: { trackedSeconds: t.trackedSeconds, activeSeconds: t.activeSeconds, sedentarySeconds: t.sedentarySeconds },
    prefs,
    exams,
    journal: heavy ? { heavyDays: heavy.heavyDays, feelings: heavy.topNegative.map((n) => emotionMeta(n).label.toLowerCase()) } : null,
  });
  await syncRecommendations(db, today, recs);
}

/** Saves (or edits) a check-in, re-runs the experimental stress model and refreshes recommendations. */
export async function saveCheckIn(db: Db, prefs: Preferences, input: CheckInInput): Promise<CheckIn> {
  const saved = await upsertCheckIn(db, input);
  const p = predictStress(saved);
  const inputs: Record<string, number> = {};
  for (const i of p.inputs) inputs[i.feature] = i.value;
  await saveAssessment(db, {
    dateKey: saved.dateKey,
    checkInId: saved.id,
    modelId: p.modelId,
    predicted: p.predicted,
    probabilities: p.scores,
    inputs,
  });
  await refreshRecommendations(db, prefs);
  return saved;
}

export async function acceptRecommendationGoal(
  db: Db,
  rec: StoredRecommendation,
  action: RecommendationAction,
): Promise<void> {
  if (action.kind !== 'goal' || !action.goal) return;
  await createGoal(db, { ...action.goal, sourceRecommendationKey: rec.ruleId });
  await setRecommendationStatus(db, rec.id, 'accepted');
}
