import { describe, expect, it } from '@jest/globals';
import { dailyActivity, totalsFor } from '@/features/analytics/aggregations';
import { validateCheckIn, parseNumber } from '@/features/wellness/checkinValidation';
import { generateRecommendations, type RecommendationContext } from '@/features/wellness/recommendationEngine';
import { addDays, lastNDays } from '@/lib/dates';
import { DEFAULT_PREFERENCES, emptyDurations, type ActivitySession, type CheckIn, type CheckInInput } from '@/types/domain';

const base: CheckInInput = {
  dateKey: '2026-10-30',
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
};

function ci(dateKey: string, patch: Partial<CheckInInput> = {}): CheckIn {
  return { ...base, ...patch, dateKey, id: 1, createdAt: 0, updatedAt: 0 };
}

function ctx(checkIns: CheckIn[], patch: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    todayKey: '2026-10-30',
    checkIns,
    todayActivity: { trackedSeconds: 0, activeSeconds: 0, sedentarySeconds: 0 },
    prefs: DEFAULT_PREFERENCES,
    ...patch,
  };
}

const ids = (c: RecommendationContext) => generateRecommendations(c).map((r) => r.ruleId);

describe('check-in validation', () => {
  it('accepts a valid entry', () => expect(validateCheckIn(base)).toEqual({}));
  it('rejects out-of-range and non-numeric values', () => {
    const e = validateCheckIn({ ...base, sleepHours: 20, studyHours: NaN, mood: 7 });
    expect(e.sleepHours).toBeDefined();
    expect(e.studyHours).toBeDefined();
    expect(e.mood).toBeDefined();
  });
  it('rejects days with more than 24 committed hours', () => {
    expect(validateCheckIn({ ...base, sleepHours: 12, studyHours: 12, socialHours: 2 }).form).toBeDefined();
  });
  it('parses decimal input with comma or dot', () => {
    expect(parseNumber('7,5')).toBe(7.5);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('abc')).toBeNaN();
  });
});

describe('recommendation engine', () => {
  it('asks for a check-in when there is no data', () => {
    expect(ids(ctx([]))).toEqual(['checkin-missing']);
  });

  it('reports a balanced state when nothing triggers', () => {
    expect(ids(ctx([ci('2026-10-30')]))).toEqual(['balanced']);
  });

  it('triggers sleep, study and pressure rules from the latest check-in, with evidence', () => {
    const recs = generateRecommendations(ctx([ci('2026-10-30', { sleepHours: 5, studyHours: 9, academicPressure: 5 })]));
    const r = recs.map((x) => x.ruleId);
    expect(r).toEqual(expect.arrayContaining(['sleep-low', 'study-long', 'pressure-high']));
    expect(recs.find((x) => x.ruleId === 'sleep-low')?.evidence).toContain('5 h');
  });

  it('flags persistently elevated self-reported stress', () => {
    const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
    const list = days.map((d, i) => ci(d, { stressLevel: i % 2 === 0 ? 4 : 2 }));
    expect(ids(ctx(list))).toContain('stress-persistent');
    expect(generateRecommendations(ctx(list))[0].ruleId).toBe('stress-persistent');
  });

  it('uses live tracking data for the sedentary rule', () => {
    const r = ids(ctx([ci('2026-10-30')], { todayActivity: { trackedSeconds: 3600, activeSeconds: 60, sedentarySeconds: 3500 } }));
    expect(r).toContain('sedentary-tracked');
  });

  it('updates when the check-in is edited', () => {
    expect(ids(ctx([ci('2026-10-30', { screenTimeHours: 8 })]))).toContain('screen-high');
    expect(ids(ctx([ci('2026-10-30', { screenTimeHours: 1 })]))).not.toContain('screen-high');
  });
});

describe('analytics aggregations', () => {
  const session = (dateKey: string, source: 'live' | 'replay', walk: number, sit: number): ActivitySession => ({
    id: 1,
    source,
    startedAt: 0,
    endedAt: 0,
    dateKey,
    trackedSeconds: walk + sit,
    durations: { ...emptyDurations(), WALKING: walk, SITTING: sit },
    windowCount: 1,
    steps: null,
    modelId: 'm',
    replaySequence: null,
    meanSampleRateHz: null,
  });

  it('excludes replay sessions from personal totals', () => {
    const t = totalsFor([session('2026-10-30', 'live', 100, 50), session('2026-10-30', 'replay', 999, 999)]);
    expect(t.activeSeconds).toBe(100);
    expect(t.sedentarySeconds).toBe(50);
    expect(t.sessionCount).toBe(1);
    expect(t.steps).toBeNull();
  });

  it('builds a zero-filled daily series', () => {
    const days = lastNDays(7, '2026-10-30');
    expect(days[0]).toBe(addDays('2026-10-30', -6));
    const d = dailyActivity([session('2026-10-29', 'live', 60, 0)], days);
    expect(d).toHaveLength(7);
    expect(d[5].activeSeconds).toBe(60);
    expect(d[6].trackedSeconds).toBe(0);
  });
});
