/**
 * Versioned SQLite schema. Each entry migrates the database from version i to i + 1.
 * The current version is stored in PRAGMA user_version. Never edit a shipped migration;
 * append a new one instead.
 */
export const MIGRATIONS: readonly string[] = [
  // v1 — initial schema
  `
  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL UNIQUE,
    sleep_hours REAL NOT NULL,
    study_hours REAL NOT NULL,
    academic_pressure INTEGER NOT NULL,
    screen_time_hours REAL NOT NULL,
    physical_activity_minutes REAL NOT NULL,
    social_hours REAL NOT NULL,
    extracurricular_hours REAL NOT NULL,
    stress_level INTEGER NOT NULL,
    mood INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK (source IN ('live', 'replay')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    date_key TEXT NOT NULL,
    tracked_seconds REAL NOT NULL,
    durations_json TEXT NOT NULL,
    window_count INTEGER NOT NULL,
    steps INTEGER,
    model_id TEXT NOT NULL,
    replay_sequence TEXT,
    mean_sample_rate REAL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON activity_sessions (date_key, source);

  CREATE TABLE IF NOT EXISTS stress_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL,
    checkin_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    predicted TEXT NOT NULL,
    probabilities_json TEXT NOT NULL,
    inputs_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assess_date ON stress_assessments (date_key);

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    source_recommendation_key TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goal_logs (
    goal_id INTEGER NOT NULL,
    date_key TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (goal_id, date_key)
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    category TEXT NOT NULL,
    priority INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    evidence TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (date_key, rule_id)
  );
  `,
  // v2 — all-day step totals read from the OS step history (iOS Core Motion)
  `
  CREATE TABLE IF NOT EXISTS daily_steps (
    date_key TEXT PRIMARY KEY NOT NULL,
    steps INTEGER NOT NULL,
    source TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  );
  `,
  // v3 — exam/deadline planner and the AI coach conversation
  `
  CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date_key TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'exam',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_exams_date ON exams (date_key);

  CREATE TABLE IF NOT EXISTS coach_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at INTEGER NOT NULL
  );
  `,
  // v4 — journal (with optional emotion analysis) and completed breathing / focus practices
  `
  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    prompt TEXT,
    analysis_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries (date_key);

  CREATE TABLE IF NOT EXISTS practice_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('breathing', 'focus')),
    date_key TEXT NOT NULL,
    seconds INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_practice_date ON practice_sessions (date_key);
  `,
  // v5 — journal tags (comma-separated, lower case) and time spent writing
  `
  ALTER TABLE journal_entries ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  ALTER TABLE journal_entries ADD COLUMN writing_seconds INTEGER NOT NULL DEFAULT 0;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export const USER_TABLES = [
  'preferences',
  'checkins',
  'activity_sessions',
  'stress_assessments',
  'goals',
  'goal_logs',
  'recommendations',
  'daily_steps',
  'exams',
  'coach_messages',
  'journal_entries',
  'practice_sessions',
] as const;

/** Tables restored from a backup, keyed by their name in the export JSON (preferences are handled separately). */
export const BACKUP_TABLES = {
  checkins: 'checkins',
  activitySessions: 'activity_sessions',
  stressAssessments: 'stress_assessments',
  goals: 'goals',
  goalLogs: 'goal_logs',
  recommendations: 'recommendations',
  dailySteps: 'daily_steps',
  exams: 'exams',
  coachMessages: 'coach_messages',
  journalEntries: 'journal_entries',
  practiceSessions: 'practice_sessions',
} as const;
