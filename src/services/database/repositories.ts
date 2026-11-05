/**
 * Data-access functions. Screens never write SQL directly; they call these.
 * Each function takes the database handle so it can be used from hooks and tests alike.
 */
import type * as SQLite from 'expo-sqlite';

import { addDays, todayKey } from '@/lib/dates';
import {
  DEFAULT_PREFERENCES,
  emptyDurations,
  type ActivityDurations,
  type ActivitySession,
  type CheckIn,
  type CheckInInput,
  type CoachMessage,
  type Exam,
  type ExamKind,
  type Goal,
  type GoalCategory,
  type GoalWithProgress,
  type JournalEntryRecord,
  type PracticeKind,
  type PracticeSession,
  type Preferences,
  type Recommendation,
  type RecommendationAction,
  type RecommendationStatus,
  type RiskLevel,
  type SessionSource,
  type StoredRecommendation,
  type StressAssessment,
} from '@/types/domain';

import { EXPORT_APP_ID, sanitizePreferences, type WellTrackExport } from './backupFormat';
import { transaction, type Db } from './db';
import { BACKUP_TABLES, SCHEMA_VERSION } from './schema';

// ---------- preferences ----------

export async function getPreferences(db: Db): Promise<Preferences> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM preferences');
  const prefs: Preferences = { ...DEFAULT_PREFERENCES };
  for (const r of rows) {
    if (r.key in prefs) {
      try {
        (prefs as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
      } catch {
        // ignore corrupt value, keep default
      }
    }
  }
  return prefs;
}

export async function setPreferences(db: Db, patch: Partial<Preferences>): Promise<void> {
  await transaction(db, async () => {
    for (const [k, v] of Object.entries(patch)) {
      await db.runAsync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', k, JSON.stringify(v));
    }
  });
}

// ---------- check-ins ----------

interface CheckInRow {
  id: number;
  date_key: string;
  sleep_hours: number;
  study_hours: number;
  academic_pressure: number;
  screen_time_hours: number;
  physical_activity_minutes: number;
  social_hours: number;
  extracurricular_hours: number;
  stress_level: number;
  mood: number;
  notes: string;
  created_at: number;
  updated_at: number;
}

function toCheckIn(r: CheckInRow): CheckIn {
  return {
    id: r.id,
    dateKey: r.date_key,
    sleepHours: r.sleep_hours,
    studyHours: r.study_hours,
    academicPressure: r.academic_pressure,
    screenTimeHours: r.screen_time_hours,
    physicalActivityMinutes: r.physical_activity_minutes,
    socialHours: r.social_hours,
    extracurricularHours: r.extracurricular_hours,
    stressLevel: r.stress_level,
    mood: r.mood,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function upsertCheckIn(db: Db, input: CheckInInput): Promise<CheckIn> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO checkins (date_key, sleep_hours, study_hours, academic_pressure, screen_time_hours,
       physical_activity_minutes, social_hours, extracurricular_hours, stress_level, mood, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date_key) DO UPDATE SET
       sleep_hours = excluded.sleep_hours, study_hours = excluded.study_hours,
       academic_pressure = excluded.academic_pressure, screen_time_hours = excluded.screen_time_hours,
       physical_activity_minutes = excluded.physical_activity_minutes, social_hours = excluded.social_hours,
       extracurricular_hours = excluded.extracurricular_hours, stress_level = excluded.stress_level,
       mood = excluded.mood, notes = excluded.notes, updated_at = excluded.updated_at`,
    input.dateKey,
    input.sleepHours,
    input.studyHours,
    input.academicPressure,
    input.screenTimeHours,
    input.physicalActivityMinutes,
    input.socialHours,
    input.extracurricularHours,
    input.stressLevel,
    input.mood,
    input.notes,
    now,
    now,
  );
  const saved = await getCheckIn(db, input.dateKey);
  if (!saved) throw new Error('check-in was not saved');
  return saved;
}

export async function getCheckIn(db: Db, dateKey: string): Promise<CheckIn | null> {
  const r = await db.getFirstAsync<CheckInRow>('SELECT * FROM checkins WHERE date_key = ?', dateKey);
  return r ? toCheckIn(r) : null;
}

export async function listCheckIns(db: Db, fromKey: string, toKey: string = todayKey()): Promise<CheckIn[]> {
  const rows = await db.getAllAsync<CheckInRow>(
    'SELECT * FROM checkins WHERE date_key >= ? AND date_key <= ? ORDER BY date_key ASC',
    fromKey,
    toKey,
  );
  return rows.map(toCheckIn);
}

export async function recentCheckIns(db: Db, days: number): Promise<CheckIn[]> {
  return listCheckIns(db, addDays(todayKey(), -(days - 1)));
}

// ---------- activity sessions ----------

interface SessionRow {
  id: number;
  source: SessionSource;
  started_at: number;
  ended_at: number;
  date_key: string;
  tracked_seconds: number;
  durations_json: string;
  window_count: number;
  steps: number | null;
  model_id: string;
  replay_sequence: string | null;
  mean_sample_rate: number | null;
}

function toSession(r: SessionRow): ActivitySession {
  let durations: ActivityDurations = emptyDurations();
  try {
    durations = { ...durations, ...(JSON.parse(r.durations_json) as Partial<ActivityDurations>) };
  } catch {
    // keep zeros
  }
  return {
    id: r.id,
    source: r.source,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    dateKey: r.date_key,
    trackedSeconds: r.tracked_seconds,
    durations,
    windowCount: r.window_count,
    steps: r.steps,
    modelId: r.model_id,
    replaySequence: r.replay_sequence,
    meanSampleRateHz: r.mean_sample_rate,
  };
}

export async function insertSession(db: Db, s: Omit<ActivitySession, 'id'>): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO activity_sessions (source, started_at, ended_at, date_key, tracked_seconds, durations_json,
       window_count, steps, model_id, replay_sequence, mean_sample_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.source,
    s.startedAt,
    s.endedAt,
    s.dateKey,
    s.trackedSeconds,
    JSON.stringify(s.durations),
    s.windowCount,
    s.steps,
    s.modelId,
    s.replaySequence,
    s.meanSampleRateHz,
  );
  return res.lastInsertRowId;
}

export async function listSessions(
  db: Db,
  opts: { source?: SessionSource; fromKey?: string; limit?: number } = {},
): Promise<ActivitySession[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.source) {
    where.push('source = ?');
    params.push(opts.source);
  }
  if (opts.fromKey) {
    where.push('date_key >= ?');
    params.push(opts.fromKey);
  }
  const sql = `SELECT * FROM activity_sessions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY started_at DESC ${opts.limit ? `LIMIT ${Math.floor(opts.limit)}` : ''}`;
  const rows = await db.getAllAsync<SessionRow>(sql, ...params);
  return rows.map(toSession);
}

export async function deleteSession(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM activity_sessions WHERE id = ?', id);
}

// ---------- stress assessments ----------

interface AssessmentRow {
  id: number;
  date_key: string;
  checkin_id: number;
  model_id: string;
  predicted: RiskLevel;
  probabilities_json: string;
  inputs_json: string;
  created_at: number;
}

function toAssessment(r: AssessmentRow): StressAssessment {
  return {
    id: r.id,
    dateKey: r.date_key,
    checkInId: r.checkin_id,
    modelId: r.model_id,
    predicted: r.predicted,
    probabilities: JSON.parse(r.probabilities_json) as Record<string, number>,
    inputs: JSON.parse(r.inputs_json) as Record<string, number>,
    createdAt: r.created_at,
  };
}

/** One assessment per day: re-running for the same day (e.g. after editing a check-in) replaces it. */
export async function saveAssessment(db: Db, a: Omit<StressAssessment, 'id' | 'createdAt'>): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM stress_assessments WHERE date_key = ?', a.dateKey);
    await db.runAsync(
      `INSERT INTO stress_assessments (date_key, checkin_id, model_id, predicted, probabilities_json, inputs_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      a.dateKey,
      a.checkInId,
      a.modelId,
      a.predicted,
      JSON.stringify(a.probabilities),
      JSON.stringify(a.inputs),
      Date.now(),
    );
  });
}

export async function listAssessments(db: Db, fromKey?: string): Promise<StressAssessment[]> {
  const rows = fromKey
    ? await db.getAllAsync<AssessmentRow>(
        'SELECT * FROM stress_assessments WHERE date_key >= ? ORDER BY date_key ASC',
        fromKey,
      )
    : await db.getAllAsync<AssessmentRow>('SELECT * FROM stress_assessments ORDER BY date_key ASC');
  return rows.map(toAssessment);
}

export async function latestAssessment(db: Db): Promise<StressAssessment | null> {
  const r = await db.getFirstAsync<AssessmentRow>('SELECT * FROM stress_assessments ORDER BY date_key DESC LIMIT 1');
  return r ? toAssessment(r) : null;
}

// ---------- goals ----------

interface GoalRow {
  id: number;
  title: string;
  description: string;
  category: GoalCategory;
  source_recommendation_key: string | null;
  status: 'active' | 'archived';
  created_at: number;
}

function toGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    sourceRecommendationKey: r.source_recommendation_key,
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function createGoal(
  db: Db,
  g: { title: string; description: string; category: GoalCategory; sourceRecommendationKey?: string | null },
): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM goals WHERE title = ? AND status = 'active'",
    g.title,
  );
  if (existing) return existing.id;
  const res = await db.runAsync(
    'INSERT INTO goals (title, description, category, source_recommendation_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    g.title,
    g.description,
    g.category,
    g.sourceRecommendationKey ?? null,
    'active',
    Date.now(),
  );
  return res.lastInsertRowId;
}

export async function setGoalStatus(db: Db, id: number, status: 'active' | 'archived'): Promise<void> {
  await db.runAsync('UPDATE goals SET status = ? WHERE id = ?', status, id);
}

export async function deleteGoal(db: Db, id: number): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM goal_logs WHERE goal_id = ?', id);
    await db.runAsync('DELETE FROM goals WHERE id = ?', id);
  });
}

export async function setGoalCompleted(db: Db, goalId: number, dateKey: string, completed: boolean): Promise<void> {
  if (completed) {
    await db.runAsync(
      'INSERT OR REPLACE INTO goal_logs (goal_id, date_key, completed_at) VALUES (?, ?, ?)',
      goalId,
      dateKey,
      Date.now(),
    );
  } else {
    await db.runAsync('DELETE FROM goal_logs WHERE goal_id = ? AND date_key = ?', goalId, dateKey);
  }
}

export async function listGoalLogs(db: Db, fromKey: string): Promise<{ goalId: number; dateKey: string }[]> {
  const rows = await db.getAllAsync<{ goal_id: number; date_key: string }>(
    'SELECT goal_id, date_key FROM goal_logs WHERE date_key >= ?',
    fromKey,
  );
  return rows.map((r) => ({ goalId: r.goal_id, dateKey: r.date_key }));
}

export async function listGoals(db: Db, status: 'active' | 'archived' | 'all' = 'active'): Promise<GoalWithProgress[]> {
  const rows =
    status === 'all'
      ? await db.getAllAsync<GoalRow>('SELECT * FROM goals ORDER BY created_at DESC')
      : await db.getAllAsync<GoalRow>('SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC', status);
  const today = todayKey();
  const logs = await listGoalLogs(db, addDays(today, -60));
  const byGoal = new Map<number, Set<string>>();
  for (const l of logs) {
    if (!byGoal.has(l.goalId)) byGoal.set(l.goalId, new Set());
    byGoal.get(l.goalId)?.add(l.dateKey);
  }
  return rows.map((r) => {
    const days = byGoal.get(r.id) ?? new Set<string>();
    let completionsLast7 = 0;
    for (let i = 0; i < 7; i++) if (days.has(addDays(today, -i))) completionsLast7++;
    let streak = 0;
    // streak counts back from today (or yesterday if today not yet done)
    let cursor = days.has(today) ? today : addDays(today, -1);
    while (days.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return { ...toGoal(r), completedToday: days.has(today), completionsLast7, streak };
  });
}

// ---------- recommendations ----------

interface RecommendationRow {
  id: number;
  date_key: string;
  rule_id: string;
  category: GoalCategory;
  priority: number;
  title: string;
  body: string;
  evidence: string;
  actions_json: string;
  status: RecommendationStatus;
  created_at: number;
  updated_at: number;
}

function toRecommendation(r: RecommendationRow): StoredRecommendation {
  return {
    id: r.id,
    dateKey: r.date_key,
    ruleId: r.rule_id,
    category: r.category,
    priority: r.priority,
    title: r.title,
    body: r.body,
    evidence: r.evidence,
    actions: JSON.parse(r.actions_json) as RecommendationAction[],
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Stores today's generated recommendations. Content is refreshed (evidence can change after
 * a check-in edit) but user-set status is preserved. Today's rules that no longer fire and
 * were never acted on are removed.
 */
export async function syncRecommendations(db: Db, dateKey: string, recs: Recommendation[]): Promise<void> {
  const now = Date.now();
  await transaction(db, async () => {
    for (const r of recs) {
      await db.runAsync(
        `INSERT INTO recommendations (date_key, rule_id, category, priority, title, body, evidence, actions_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
         ON CONFLICT(date_key, rule_id) DO UPDATE SET
           category = excluded.category, priority = excluded.priority, title = excluded.title, body = excluded.body,
           evidence = excluded.evidence, actions_json = excluded.actions_json, updated_at = excluded.updated_at`,
        dateKey,
        r.ruleId,
        r.category,
        r.priority,
        r.title,
        r.body,
        r.evidence,
        JSON.stringify(r.actions),
        now,
        now,
      );
    }
    const ids = recs.map((r) => r.ruleId);
    const placeholders = ids.map(() => '?').join(',');
    await db.runAsync(
      `DELETE FROM recommendations WHERE date_key = ? AND status = 'new' ${ids.length ? `AND rule_id NOT IN (${placeholders})` : ''}`,
      dateKey,
      ...ids,
    );
  });
}

export async function listRecommendations(
  db: Db,
  opts: { dateKey?: string; fromKey?: string } = {},
): Promise<StoredRecommendation[]> {
  if (opts.dateKey) {
    const rows = await db.getAllAsync<RecommendationRow>(
      'SELECT * FROM recommendations WHERE date_key = ? ORDER BY priority DESC',
      opts.dateKey,
    );
    return rows.map(toRecommendation);
  }
  const rows = await db.getAllAsync<RecommendationRow>(
    'SELECT * FROM recommendations WHERE date_key >= ? ORDER BY date_key DESC, priority DESC',
    opts.fromKey ?? '0000-00-00',
  );
  return rows.map(toRecommendation);
}

export async function setRecommendationStatus(db: Db, id: number, status: RecommendationStatus): Promise<void> {
  await db.runAsync('UPDATE recommendations SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), id);
}

// ---------- export ----------

// ---------- daily steps (OS step history) ----------

export interface DailySteps {
  dateKey: string;
  steps: number;
  source: string;
  syncedAt: number;
}

export async function upsertDailySteps(db: Db, rows: { dateKey: string; steps: number }[], source: string): Promise<void> {
  const now = Date.now();
  await transaction(db, async () => {
    for (const r of rows) {
      await db.runAsync(
        'INSERT OR REPLACE INTO daily_steps (date_key, steps, source, synced_at) VALUES (?, ?, ?, ?)',
        r.dateKey,
        Math.max(0, Math.round(r.steps)),
        source,
        now,
      );
    }
  });
}

export async function listDailySteps(db: Db, fromKey: string, toKey: string = todayKey()): Promise<DailySteps[]> {
  const rows = await db.getAllAsync<{ date_key: string; steps: number; source: string; synced_at: number }>(
    'SELECT * FROM daily_steps WHERE date_key >= ? AND date_key <= ? ORDER BY date_key',
    fromKey,
    toKey,
  );
  return rows.map((r) => ({ dateKey: r.date_key, steps: r.steps, source: r.source, syncedAt: r.synced_at }));
}

// ---------- exams & deadlines ----------

interface ExamRow {
  id: number;
  title: string;
  date_key: string;
  kind: string;
  notes: string;
  created_at: number;
}

const mapExam = (r: ExamRow): Exam => ({
  id: r.id,
  title: r.title,
  dateKey: r.date_key,
  kind: (['exam', 'assignment', 'presentation', 'other'].includes(r.kind) ? r.kind : 'other') as ExamKind,
  notes: r.notes,
  createdAt: r.created_at,
});

export async function createExam(db: Db, e: { title: string; dateKey: string; kind: ExamKind; notes?: string }): Promise<number> {
  let id = 0;
  await transaction(db, async () => {
    const res = await db.runAsync(
      'INSERT INTO exams (title, date_key, kind, notes, created_at) VALUES (?, ?, ?, ?, ?)',
      e.title.trim(),
      e.dateKey,
      e.kind,
      e.notes?.trim() ?? '',
      Date.now(),
    );
    id = res.lastInsertRowId;
  });
  return id;
}

export async function deleteExam(db: Db, id: number): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM exams WHERE id = ?', id);
  });
}

/** Exams on or after `fromKey` (default today), soonest first. */
export async function listExams(db: Db, fromKey: string = todayKey()): Promise<Exam[]> {
  const rows = await db.getAllAsync<ExamRow>('SELECT * FROM exams WHERE date_key >= ? ORDER BY date_key, id', fromKey);
  return rows.map(mapExam);
}

export async function listPastExams(db: Db, beforeKey: string = todayKey(), limit = 20): Promise<Exam[]> {
  const rows = await db.getAllAsync<ExamRow>('SELECT * FROM exams WHERE date_key < ? ORDER BY date_key DESC LIMIT ?', beforeKey, limit);
  return rows.map(mapExam);
}

// ---------- AI coach conversation ----------

export async function addCoachMessage(db: Db, m: { role: CoachMessage['role']; content: string; model?: string | null }): Promise<number> {
  let id = 0;
  await transaction(db, async () => {
    const res = await db.runAsync(
      'INSERT INTO coach_messages (role, content, model, created_at) VALUES (?, ?, ?, ?)',
      m.role,
      m.content,
      m.model ?? null,
      Date.now(),
    );
    id = res.lastInsertRowId;
  });
  return id;
}

/** Most recent `limit` messages, oldest first. */
export async function listCoachMessages(db: Db, limit = 200): Promise<CoachMessage[]> {
  const rows = await db.getAllAsync<{ id: number; role: CoachMessage['role']; content: string; model: string | null; created_at: number }>(
    'SELECT * FROM (SELECT * FROM coach_messages ORDER BY id DESC LIMIT ?) ORDER BY id',
    limit,
  );
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, model: r.model, createdAt: r.created_at }));
}

export async function clearCoachMessages(db: Db): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM coach_messages');
  });
}

// ---------- journal ----------

interface JournalRow {
  id: number;
  date_key: string;
  title: string;
  body: string;
  prompt: string | null;
  tags: string;
  writing_seconds: number;
  analysis_json: string | null;
  created_at: number;
  updated_at: number;
}

const mapJournal = (r: JournalRow): JournalEntryRecord => ({
  id: r.id,
  dateKey: r.date_key,
  title: r.title,
  body: r.body,
  prompt: r.prompt,
  tags: r.tags ?? '',
  writingSeconds: r.writing_seconds ?? 0,
  analysisJson: r.analysis_json,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function saveJournalEntry(
  db: Db,
  e: { id?: number | null; dateKey: string; title: string; body: string; prompt?: string | null; tags?: string; addSeconds?: number },
): Promise<number> {
  const now = Date.now();
  let id = e.id ?? 0;
  await transaction(db, async () => {
    if (e.id) {
      await db.runAsync(
        'UPDATE journal_entries SET date_key = ?, title = ?, body = ?, prompt = ?, tags = ?, writing_seconds = writing_seconds + ?, updated_at = ? WHERE id = ?',
        e.dateKey, e.title.trim(), e.body, e.prompt ?? null, e.tags ?? '', Math.round(e.addSeconds ?? 0), now, e.id,
      );
    } else {
      const res = await db.runAsync(
        'INSERT INTO journal_entries (date_key, title, body, prompt, tags, writing_seconds, analysis_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
        e.dateKey, e.title.trim(), e.body, e.prompt ?? null, e.tags ?? '', Math.round(e.addSeconds ?? 0), now, now,
      );
      id = res.lastInsertRowId;
    }
  });
  return id;
}

export async function setJournalAnalysis(db: Db, id: number, analysisJson: string | null): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('UPDATE journal_entries SET analysis_json = ? WHERE id = ?', analysisJson, id);
  });
}

export async function getJournalEntry(db: Db, id: number): Promise<JournalEntryRecord | null> {
  const row = await db.getFirstAsync<JournalRow>('SELECT * FROM journal_entries WHERE id = ?', id);
  return row ? mapJournal(row) : null;
}

/** Entries between two date keys (inclusive), newest first. */
export async function listJournalEntries(db: Db, fromKey = '0000-00-00', toKey = '9999-99-99'): Promise<JournalEntryRecord[]> {
  const rows = await db.getAllAsync<JournalRow>(
    'SELECT * FROM journal_entries WHERE date_key >= ? AND date_key <= ? ORDER BY date_key DESC, created_at DESC',
    fromKey, toKey,
  );
  return rows.map(mapJournal);
}

export async function deleteJournalEntry(db: Db, id: number): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM journal_entries WHERE id = ?', id);
  });
}

// ---------- breathing & focus practices ----------

export async function logPractice(db: Db, kind: PracticeKind, seconds: number, dateKey: string = todayKey()): Promise<void> {
  if (seconds < 20) return;
  await transaction(db, async () => {
    await db.runAsync('INSERT INTO practice_sessions (kind, date_key, seconds, created_at) VALUES (?, ?, ?, ?)', kind, dateKey, Math.round(seconds), Date.now());
  });
}

export async function listPractices(db: Db, fromKey: string, toKey: string = todayKey()): Promise<PracticeSession[]> {
  const rows = await db.getAllAsync<{ id: number; kind: PracticeKind; date_key: string; seconds: number; created_at: number }>(
    'SELECT * FROM practice_sessions WHERE date_key >= ? AND date_key <= ? ORDER BY date_key',
    fromKey, toKey,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, dateKey: r.date_key, seconds: r.seconds, createdAt: r.created_at }));
}

// ---------- export / import ----------

export async function exportAll(db: Db): Promise<WellTrackExport> {
  return {
    exportedAt: new Date().toISOString(),
    app: EXPORT_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    preferences: await getPreferences(db),
    checkins: await db.getAllAsync('SELECT * FROM checkins ORDER BY date_key'),
    activitySessions: await db.getAllAsync('SELECT * FROM activity_sessions ORDER BY started_at'),
    stressAssessments: await db.getAllAsync('SELECT * FROM stress_assessments ORDER BY date_key'),
    goals: await db.getAllAsync('SELECT * FROM goals ORDER BY created_at'),
    goalLogs: await db.getAllAsync('SELECT * FROM goal_logs ORDER BY date_key'),
    recommendations: await db.getAllAsync('SELECT * FROM recommendations ORDER BY date_key'),
    dailySteps: await db.getAllAsync('SELECT * FROM daily_steps ORDER BY date_key'),
    exams: await db.getAllAsync('SELECT * FROM exams ORDER BY date_key'),
    coachMessages: await db.getAllAsync('SELECT * FROM coach_messages ORDER BY id'),
    journalEntries: await db.getAllAsync('SELECT * FROM journal_entries ORDER BY id'),
    practiceSessions: await db.getAllAsync('SELECT * FROM practice_sessions ORDER BY id'),
  };
}

/** Number of user records (excluding preferences) — used to decide whether a device is "empty". */
export async function userRecordCount(db: Db): Promise<number> {
  let n = 0;
  for (const table of Object.values(BACKUP_TABLES)) {
    const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    n += r?.n ?? 0;
  }
  return n;
}

/**
 * Replaces every record on this device with the contents of a WellTrack export
 * (file restore or cloud restore). Unknown columns are ignored; the whole import is one transaction.
 */
export async function importAll(db: Db, data: WellTrackExport): Promise<number> {
  let inserted = 0;
  await transaction(db, async () => {
    for (const [key, table] of Object.entries(BACKUP_TABLES)) {
      await db.runAsync(`DELETE FROM ${table}`);
      const rows = data[key as keyof typeof BACKUP_TABLES];
      if (!rows?.length) continue;
      const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
      const allowed = new Set(info.map((c) => c.name));
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => allowed.has(c));
        if (!cols.length) continue;
        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          ...cols.map((c) => row[c] as SQLite.SQLiteBindValue),
        );
        inserted++;
      }
    }
    const prefs = sanitizePreferences(data.preferences);
    for (const [k, v] of Object.entries(prefs)) {
      await db.runAsync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', k, JSON.stringify(v));
    }
  });
  return inserted;
}
