/** Loads the stored data behind Insights and the coach: recap, patterns and the personal model. */
import { dailyActivity } from '@/features/analytics/aggregations';
import { addDays, lastNDays } from '@/lib/dates';
import type { Db } from '@/services/database/db';
import { listCheckIns, listDailySteps, listGoalLogs, listSessions } from '@/services/database/repositories';
import type { CheckIn, Preferences } from '@/types/domain';

import { findPatterns, type DailyFactors, type PatternResult } from './patterns';
import { trainPersonalModel, type PersonalModel } from './personalModel';
import { weeklyRecap, type WeeklyRecap } from './weeklyRecap';

export const INSIGHT_WINDOW_DAYS = 90;

export interface InsightsData {
  checkIns: CheckIn[];
  recap: WeeklyRecap;
  patterns: PatternResult;
  model: PersonalModel;
  todaySteps: number | null;
}

export async function loadInsights(db: Db, prefs: Preferences, today: string): Promise<InsightsData> {
  const from = addDays(today, -(INSIGHT_WINDOW_DAYS - 1));
  const [checkIns, sessions, goalLogs, steps] = await Promise.all([
    listCheckIns(db, from, today),
    listSessions(db, { source: 'live', fromKey: from }),
    listGoalLogs(db, addDays(today, -13)),
    listDailySteps(db, from, today),
  ]);
  const stepsByDay = new Map(steps.map((s) => [s.dateKey, s.steps]));
  const activity = new Map(dailyActivity(sessions, lastNDays(INSIGHT_WINDOW_DAYS, today)).map((d) => [d.dateKey, d]));
  // Active minutes only count on days that had a tracked session; untracked days are unknown, not zero.
  const extras: DailyFactors[] = checkIns.map((c) => {
    const a = activity.get(c.dateKey);
    return {
      dateKey: c.dateKey,
      steps: stepsByDay.get(c.dateKey) ?? null,
      activeMinutes: a && a.sessionCount > 0 ? a.activeSeconds / 60 : null,
    };
  });
  return {
    checkIns,
    recap: weeklyRecap({ today, checkIns, sessions, goalLogs, dailySteps: steps }),
    patterns: findPatterns(checkIns, prefs, extras),
    model: trainPersonalModel(checkIns, extras),
    todaySteps: stepsByDay.get(today) ?? null,
  };
}
