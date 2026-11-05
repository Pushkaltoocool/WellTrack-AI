import { describe, expect, it } from '@jest/globals';
import { findPatterns } from '@/features/insights/patterns';
import { trainPersonalModel } from '@/features/insights/personalModel';
import { weeklyRecap } from '@/features/insights/weeklyRecap';
import { addDays, lastNDays } from '@/lib/dates';
import { emptyDurations, type ActivitySession, type CheckIn, type CheckInInput } from '@/types/domain';

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

let nextId = 1;
function ci(dateKey: string, patch: Partial<CheckInInput> = {}): CheckIn {
  return { ...base, ...patch, dateKey, id: nextId++, createdAt: 0, updatedAt: 0 };
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFS = { sleepGoalHours: 8, activeMinutesGoal: 30 };
const CAUSAL = /\b(caus|because|leads? to|results? in|due to|makes? you|improves?|reduces?)/i;

describe('findPatterns', () => {
  it('reports insufficient data below the minimum number of days', () => {
    const days = lastNDays(5, '2026-10-30').map((d) => ci(d));
    const r = findPatterns(days, PREFS);
    expect(r).toEqual({ patterns: [], daysAnalysed: 5, enoughData: false, daysNeeded: 2 });
  });

  it('detects a clear sleep → mood pattern with correct means and counts', () => {
    const days = lastNDays(18, '2026-10-30');
    // 12 nights at/above goal (mood 4, one 3) and 6 short nights (mood 3). Everything else constant.
    const list = days.map((d, i) =>
      i < 12 ? ci(d, { sleepHours: 8.5, mood: i === 0 ? 3 : 4 }) : ci(d, { sleepHours: 6, mood: 3 }),
    );
    const r = findPatterns(list, PREFS);
    expect(r.enoughData).toBe(true);
    expect(r.daysAnalysed).toBe(18);
    expect(r.patterns).toHaveLength(1);
    const p = r.patterns[0];
    expect(p.id).toBe('sleep-mood');
    expect(p.outcome).toBe('mood');
    expect(p.highN).toBe(12);
    expect(p.lowN).toBe(6);
    expect(p.highMean).toBeCloseTo(47 / 12, 6);
    expect(p.lowMean).toBe(3);
    expect(p.diff).toBeCloseTo(47 / 12 - 3, 6);
    expect(p.favourable).toBe(true);
    expect(p.text).toBe('On days you slept at least 8 h, your mood averaged 3.9 vs 3.0 on shorter nights (12 vs 6 days).');
  });

  it('marks a high-group stress increase as unfavourable', () => {
    const list = lastNDays(10, '2026-10-30').map((d, i) =>
      i % 2 === 0 ? ci(d, { studyHours: 8, stressLevel: 4 }) : ci(d, { studyHours: 3, stressLevel: 2 }),
    );
    const p = findPatterns(list, PREFS).patterns.find((x) => x.id === 'study-stress');
    expect(p?.diff).toBe(2);
    expect(p?.favourable).toBe(false);
  });

  it('respects minPerGroup', () => {
    const list = lastNDays(12, '2026-10-30').map((d, i) =>
      i < 10 ? ci(d, { sleepHours: 9, mood: 5 }) : ci(d, { sleepHours: 5, mood: 2 }),
    );
    expect(findPatterns(list, PREFS).patterns).toEqual([]);
    expect(findPatterns(list, PREFS, undefined, { minPerGroup: 2 }).patterns.map((p) => p.id)).toEqual(['sleep-mood']);
  });

  it('uses steps from extras only on days that have them', () => {
    const days = lastNDays(12, '2026-10-30');
    const list = days.map((d, i) => ci(d, { mood: i < 4 ? 5 : i < 8 ? 3 : 1 }));
    const extras = days.map((d, i) => ({ dateKey: d, steps: i < 4 ? 9000 : i < 8 ? 3000 : null }));
    const p = findPatterns(list, PREFS, extras).patterns.find((x) => x.id === 'steps-mood');
    expect(p).toMatchObject({ highN: 4, lowN: 4, highMean: 5, lowMean: 3 });
  });

  it('never uses causal wording and caps results at 6', () => {
    const rand = prng(7);
    const list = lastNDays(40, '2026-10-30').map((d) =>
      ci(d, {
        sleepHours: 5 + rand() * 5,
        studyHours: rand() * 10,
        screenTimeHours: rand() * 8,
        physicalActivityMinutes: rand() * 60,
        socialHours: rand() * 3,
        academicPressure: 1 + Math.floor(rand() * 5),
        mood: 1 + Math.floor(rand() * 5),
        stressLevel: 1 + Math.floor(rand() * 5),
      }),
    );
    const r = findPatterns(list, PREFS, undefined, { minDiff: 0 });
    expect(r.patterns.length).toBeLessThanOrEqual(6);
    for (const p of r.patterns) {
      expect(p.text).not.toMatch(CAUSAL);
      expect(p.text).toContain(`(${p.highN} vs ${p.lowN} days)`);
    }
    const diffs = r.patterns.map((p) => Math.abs(p.diff));
    expect([...diffs].sort((a, b) => b - a)).toEqual(diffs);
  });
});

describe('trainPersonalModel', () => {
  function synthetic(n: number, seed: number, stressOf: (c: CheckInInput, rand: () => number) => number): CheckIn[] {
    const rand = prng(seed);
    return lastNDays(n, '2026-10-30').map((d) => {
      const c: CheckInInput = {
        ...base,
        dateKey: d,
        sleepHours: 3 + rand() * 7,
        studyHours: rand() * 9,
        screenTimeHours: rand() * 7,
        physicalActivityMinutes: Math.round(rand() * 90),
        socialHours: rand() * 4,
        extracurricularHours: rand() * 3,
        academicPressure: 1 + Math.floor(rand() * 5),
      };
      const stress = Math.min(5, Math.max(1, Math.round(stressOf(c, rand))));
      return ci(d, { ...c, stressLevel: stress });
    });
  }
  const sleepDriven = (c: CheckInInput, rand: () => number) => 6 - 0.5 * c.sleepHours + (rand() - 0.5) * 0.6;

  it('learns that more sleep goes with lower stress', () => {
    const m = trainPersonalModel(synthetic(40, 42, sleepDriven));
    expect(m.status).toBe('ready');
    expect(m.n).toBe(40);
    expect(m.drivers[0]).toMatchObject({ feature: 'sleepHours', label: 'Sleep', direction: 'lowers' });
    expect(m.mae).not.toBeNull();
    expect(m.mae!).toBeLessThan(m.baselineMae!);
    expect(m.improvement!).toBeGreaterThanOrEqual(0.1);
    expect(m.trainedOn).toEqual({ from: addDays('2026-10-30', -39), to: '2026-10-30' });
    for (const d of m.drivers) expect(Math.abs(d.weight)).toBeGreaterThanOrEqual(0.05);
  });

  it('is deterministic', () => {
    const data = synthetic(30, 3, sleepDriven);
    const a = trainPersonalModel(data);
    const b = trainPersonalModel(data);
    expect(a.mae).toBe(b.mae);
    expect(a.drivers).toEqual(b.drivers);
  });

  it('clamps predictions to the 1–5 scale', () => {
    const m = trainPersonalModel(synthetic(40, 42, sleepDriven));
    expect(m.predict!({ sleepHours: 100 })).toBe(1);
    expect(m.predict!({ sleepHours: -100 })).toBe(5);
    const mid = m.predict!({ sleepHours: 7 });
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(5);
  });

  it('does not offer a model when it cannot beat the average on pure noise', () => {
    // Note: chance correlations can still pass the gate occasionally (seed 99 does), so this is one representative seed.
    const m = trainPersonalModel(synthetic(40, 1, (_c, rand) => 1 + Math.floor(rand() * 5)));
    expect(m.status).toBe('not-better');
    expect(m.predict).toBeNull();
    expect(m.improvement!).toBeLessThan(0.1);
  });

  it('is insufficient below minN', () => {
    const m = trainPersonalModel(synthetic(29, 1, sleepDriven));
    expect(m).toMatchObject({ status: 'insufficient', n: 29, minN: 30, mae: null, predict: null, trainedOn: null });
    expect(m.drivers).toEqual([]);
  });

  it('includes steps only when at least 80% of days have them', () => {
    const rand = prng(11);
    const data = synthetic(30, 5, () => 3);
    const steps = data.map(() => Math.round(2000 + rand() * 10000));
    const withStress = data.map((c, i) => ({ ...c, stressLevel: steps[i] > 7000 ? 2 : 4 }));
    const full = withStress.map((c, i) => ({ dateKey: c.dateKey, steps: steps[i] }));
    const m = trainPersonalModel(withStress, full);
    expect(m.drivers[0]).toMatchObject({ feature: 'steps', label: 'Steps', direction: 'lowers' });

    const sparse = full.map((x, i) => ({ ...x, steps: i % 2 ? x.steps : null }));
    expect(trainPersonalModel(withStress, sparse).drivers.map((d) => d.feature)).not.toContain('steps');
  });
});

describe('weeklyRecap', () => {
  const today = '2026-10-31';
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

  it('computes averages, trends and highlights from the two weeks', () => {
    const cur = ['2026-10-25', '2026-10-27', '2026-10-28', '2026-10-30', '2026-10-31'].map((d, i) =>
      ci(d, { mood: i === 2 ? 5 : 4, stressLevel: 2, sleepHours: 7 }),
    );
    const prev = ['2026-10-18', '2026-10-20', '2026-10-24'].map((d) => ci(d, { mood: 3, stressLevel: 3 }));
    const r = weeklyRecap({
      today,
      checkIns: [...prev, ...cur, ci('2026-10-10', { mood: 1 })],
      sessions: [
        session('2026-10-30', 'live', 600, 300),
        session('2026-10-30', 'replay', 9999, 9999),
        session('2026-10-20', 'live', 6000, 0),
      ],
      goalLogs: [
        { goalId: 1, dateKey: '2026-10-30' },
        { goalId: 2, dateKey: '2026-10-31' },
        { goalId: 1, dateKey: '2026-10-20' },
      ],
      dailySteps: [
        { dateKey: '2026-10-30', steps: 8000 },
        { dateKey: '2026-10-31', steps: 4500 },
        { dateKey: '2026-10-01', steps: 99999 },
      ],
    });
    expect(r.from).toBe('2026-10-25');
    expect(r.to).toBe(today);
    expect(r.checkInDays).toBe(5);
    expect(r.avgMood).toBeCloseTo(4.2, 6);
    expect(r.prevAvgMood).toBe(3);
    expect(r.moodTrend).toBe('up');
    expect(r.stressTrend).toBe('down');
    expect(r.avgSleep).toBe(7);
    expect(r.trackedSessions).toBe(1);
    expect(r.activeMinutes).toBe(10);
    expect(r.goalCompletions).toBe(2);
    expect(r.totalSteps).toBe(12500);
    expect(r.stepDays).toBe(2);
    expect(r.bestDay).toEqual({ dateKey: '2026-10-28', mood: 5 });
    expect(r.highlights.length).toBeGreaterThanOrEqual(2);
    expect(r.highlights.length).toBeLessThanOrEqual(4);
    expect(r.highlights[0]).toBe('You checked in on 5 of 7 days.');
    expect(r.highlights).toContain('Mood was up 1.2 on last week (4.2 vs 3.0).');
  });

  it('reports flat when the change is small and null when a week has no data', () => {
    const r = weeklyRecap({
      today,
      checkIns: [ci('2026-10-30', { mood: 3.2 }), ci('2026-10-22', { mood: 3 })],
      sessions: [],
      goalLogs: [],
      dailySteps: [],
    });
    expect(r.moodTrend).toBe('flat');
    const noPrev = weeklyRecap({ today, checkIns: [ci('2026-10-30')], sessions: [], goalLogs: [], dailySteps: [] });
    expect(noPrev.moodTrend).toBeNull();
    expect(noPrev.stressTrend).toBeNull();
  });

  it('ignores replay-only activity and returns no highlights for an empty week', () => {
    const r = weeklyRecap({
      today,
      checkIns: [ci('2026-10-20')],
      sessions: [session('2026-10-30', 'replay', 1000, 0)],
      goalLogs: [],
      dailySteps: [],
    });
    expect(r).toMatchObject({
      checkInDays: 0,
      avgMood: null,
      avgSleep: null,
      moodTrend: null,
      activeMinutes: null,
      trackedSessions: 0,
      totalSteps: null,
      stepDays: 0,
      bestDay: null,
      goalCompletions: 0,
      highlights: [],
    });
  });
});
