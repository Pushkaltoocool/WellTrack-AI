import { describe, expect, it } from '@jest/globals';

import { countdown } from '@/features/exams/examMeta';
import { formatTime, parseTime, planReminders } from '@/features/reminders/schedule';
import { generateRecommendations } from '@/features/wellness/recommendationEngine';
import { daysBetween, timeAgo } from '@/lib/dates';
import { BackupFormatError, chunkRows, exportSummary, parseExport, sanitizePreferences } from '@/services/database/backupFormat';
import { SCHEMA_VERSION } from '@/services/database/schema';
import { authErrorMessage, isCancelled, validateSignUp } from '@/services/firebase/authErrors';
import { DEFAULT_PREFERENCES, type CheckIn } from '@/types/domain';

describe('backup format', () => {
  const valid = {
    app: 'WellTrack AI',
    exportedAt: '2026-10-30T10:00:00.000Z',
    schemaVersion: SCHEMA_VERSION,
    preferences: { displayName: 'Sam', sleepGoalHours: 8 },
    checkins: [{ id: 1, date_key: '2026-10-30' }],
    goals: [],
  };

  it('accepts a WellTrack export and keeps known sections', () => {
    const d = parseExport(valid);
    expect(d.checkins).toHaveLength(1);
    expect(d.goals).toEqual([]);
    expect(d.preferences.displayName).toBe('Sam');
  });

  it('treats exports without a schema version as v2 (pre-account builds)', () => {
    expect(parseExport({ ...valid, schemaVersion: undefined }).schemaVersion).toBe(2);
  });

  it('rejects files from other apps, newer schemas and damaged sections', () => {
    expect(() => parseExport({ ...valid, app: 'Other' })).toThrow(BackupFormatError);
    expect(() => parseExport({ ...valid, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
    expect(() => parseExport({ ...valid, checkins: 'nope' })).toThrow(/damaged/);
    expect(() => parseExport({ ...valid, checkins: [[1, 2]] })).toThrow(/damaged/);
    expect(() => parseExport(null)).toThrow(BackupFormatError);
  });

  it('sanitises preferences: unknown keys and wrong types dropped, onboarding complete', () => {
    const p = sanitizePreferences({
      displayName: 'Ana',
      sleepGoalHours: 'eight' as unknown as number,
      coachConsentAt: 123,
      ...({ evil: true } as object),
    });
    expect(p).toEqual({ displayName: 'Ana', coachConsentAt: 123, onboardingComplete: true });
    expect(sanitizePreferences({ coachConsentAt: null }).coachConsentAt).toBeNull();
    expect(sanitizePreferences(undefined)).toEqual({ onboardingComplete: true });
  });

  it('summarises record counts', () => {
    expect(exportSummary(parseExport(valid))).toEqual({ checkIns: 1, sessions: 0, goals: 0, total: 1 });
  });

  it('chunks rows under the size limit without losing or reordering any', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(100) }));
    const chunks = chunkRows(rows, 1000);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(JSON.stringify(c).length).toBeLessThan(1100);
    expect(chunks.flat()).toEqual(rows);
    expect(chunkRows([])).toEqual([]);
  });
});

describe('account helpers', () => {
  it('validates sign-up input', () => {
    expect(validateSignUp('', 'bad', 'longenough')).toMatch(/valid email/);
    expect(validateSignUp('', 'a@b.co', 'short')).toMatch(/8 characters/);
    expect(validateSignUp('Sam', 'a@b.co', 'longenough')).toBeNull();
  });

  it('maps Firebase errors to plain sentences without leaking which part was wrong', () => {
    expect(authErrorMessage({ code: 'auth/user-not-found' })).toBe(authErrorMessage({ code: 'auth/wrong-password' }));
    expect(authErrorMessage({ code: 'auth/email-already-in-use' })).toMatch(/already/);
    expect(authErrorMessage(new Error('boom'))).toBe('boom');
    expect(authErrorMessage(42)).toMatch(/try again/);
  });

  it('recognises cancelled native sign-ins', () => {
    expect(isCancelled({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
    expect(isCancelled({ code: 'auth/invalid-credential' })).toBe(false);
  });
});

describe('reminder planning', () => {
  const now = new Date(2026, 9, 30, 12, 0);
  const prefs = { ...DEFAULT_PREFERENCES };

  it('parses HH:MM and falls back on bad input', () => {
    expect(parseTime('07:05')).toEqual({ hour: 7, minute: 5 });
    expect(parseTime('25:00')).toEqual({ hour: 20, minute: 30 });
    expect(parseTime('nope', { hour: 9, minute: 0 })).toEqual({ hour: 9, minute: 0 });
    expect(formatTime('21:00')).toMatch(/9|21/);
  });

  it('schedules nothing when every reminder is off', () => {
    expect(planReminders({ ...prefs, examReminders: false }, [{ id: 1, title: 'Bio', dateKey: '2026-11-05' }], now)).toEqual([]);
  });

  it('schedules daily check-in and wind-down at the chosen times', () => {
    const plan = planReminders({ ...prefs, checkInReminder: true, checkInReminderTime: '21:15', windDownReminder: true, examReminders: false }, [], now);
    expect(plan.map((p) => p.id)).toEqual(['checkin', 'winddown']);
    expect(plan[0].trigger).toEqual({ kind: 'daily', hour: 21, minute: 15 });
    expect(plan[1].url).toBe('/breathing');
  });

  it('reminds at 18:00 the evening before future exams only', () => {
    const exams = [
      { id: 1, title: 'Past', dateKey: '2026-10-29' },
      { id: 2, title: 'Tomorrow', dateKey: '2026-10-31' }, // eve is today 18:00, still ahead
      { id: 3, title: 'Today', dateKey: '2026-10-30' }, // eve already passed
      { id: 4, title: 'Far', dateKey: '2027-06-01' }, // beyond 60-day horizon
    ];
    const plan = planReminders(prefs, exams, now);
    expect(plan.map((p) => p.id)).toEqual(['exam-2']);
    const t = plan[0].trigger;
    expect(t.kind).toBe('date');
    if (t.kind === 'date') expect([t.date.getDate(), t.date.getHours()]).toEqual([30, 18]);
  });
});

describe('dates and exams', () => {
  it('counts calendar days and describes them', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(countdown('2026-10-30', '2026-10-30')).toBe('Today');
    expect(countdown('2026-10-31', '2026-10-30')).toBe('Tomorrow');
    expect(countdown('2026-11-04', '2026-10-30')).toBe('In 5 days');
    expect(countdown('2026-10-28', '2026-10-30')).toBe('2 days ago');
  });

  it('formats relative times', () => {
    const now = Date.UTC(2026, 9, 30, 12);
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(timeAgo('garbage', now)).toBe('unknown');
  });
});

describe('recommendation rules for exams and low mood', () => {
  const day = (dateKey: string, over: Partial<CheckIn> = {}): CheckIn => ({
    id: 0,
    dateKey,
    sleepHours: 8,
    studyHours: 4,
    academicPressure: 2,
    screenTimeHours: 2,
    physicalActivityMinutes: 45,
    socialHours: 2,
    extracurricularHours: 1,
    stressLevel: 2,
    mood: 4,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });
  const base = { todayKey: '2026-10-30', todayActivity: { trackedSeconds: 0, activeSeconds: 0, sedentarySeconds: 0 }, prefs: DEFAULT_PREFERENCES };

  it('adds an exam-week suggestion within 3 days, mentioning short sleep', () => {
    const recs = generateRecommendations({
      ...base,
      checkIns: [day('2026-10-30', { sleepHours: 5.5 })],
      exams: [{ title: 'Organic chemistry', dateKey: '2026-11-01' }],
    });
    const r = recs.find((x) => x.ruleId === 'exam-soon');
    expect(r?.evidence).toMatch(/Organic chemistry is in 2 days/);
    expect(r?.evidence).toMatch(/5\.5 h of sleep/);
  });

  it('ignores exams further away or already past', () => {
    const recs = generateRecommendations({ ...base, checkIns: [day('2026-10-30')], exams: [{ title: 'X', dateKey: '2026-11-10' }, { title: 'Y', dateKey: '2026-10-29' }] });
    expect(recs.some((x) => x.ruleId === 'exam-soon')).toBe(false);
  });

  it('points to people when mood has been low on 3 of the last 5 days', () => {
    const checkIns = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((k, i) => day(k, { mood: i % 2 === 0 ? 2 : 4 }));
    const recs = generateRecommendations({ ...base, checkIns });
    const r = recs.find((x) => x.ruleId === 'mood-persistent-low');
    expect(r?.actions.some((a) => a.route === '/support')).toBe(true);
    expect(recs.some((x) => x.ruleId === 'mood-low')).toBe(false);
  });
});
