import { describe, expect, it } from '@jest/globals';
import { COACH_SYSTEM_PROMPT, buildCoachContext, type CoachContextInput } from '@/features/coach/context';
import { CRISIS_MESSAGE, detectCrisis } from '@/features/coach/safety';
import { lastNDays } from '@/lib/dates';
import type { CheckIn, CheckInInput } from '@/types/domain';

const base: CheckInInput = {
  dateKey: '2026-10-30',
  sleepHours: 7.5,
  studyHours: 4,
  academicPressure: 3,
  screenTimeHours: 3,
  physicalActivityMinutes: 20,
  socialHours: 1,
  extracurricularHours: 1,
  stressLevel: 3,
  mood: 3,
  notes: '',
};

function ci(dateKey: string, patch: Partial<CheckInInput> = {}): CheckIn {
  return { ...base, ...patch, dateKey, id: 1, createdAt: 0, updatedAt: 0 };
}

const today = '2026-10-31';

function input(patch: Partial<CoachContextInput> = {}): CoachContextInput {
  return {
    today,
    displayName: 'Alex Morgan',
    prefs: { sleepGoalHours: 8, activeMinutesGoal: 30 },
    checkIns: [ci('2026-10-30', { notes: 'Felt anxious before the lab report' })],
    includeNotes: false,
    recap: null,
    patterns: [],
    goals: [{ title: 'Lights out by 23:30', completedToday: false, streak: 2 }],
    exams: [],
    todaySteps: 4210,
    ...patch,
  };
}

describe('buildCoachContext', () => {
  it('starts with the sharing statement and uses the first name only', () => {
    const text = buildCoachContext(input());
    expect(text.split('\n')[0]).toBe('Data the user chose to share from the Wren app (self-reported unless marked):');
    expect(text).toContain('First name: Alex');
    expect(text).not.toContain('Morgan');
    expect(text).toContain('Steps today (measured): 4,210');
    expect(buildCoachContext(input({ displayName: '  ' }))).not.toContain('First name');
  });

  it('excludes check-in notes by default', () => {
    const text = buildCoachContext(input());
    expect(text).not.toContain('anxious');
    expect(text).toContain('2026-10-30: sleep 7.5 h');
  });

  it('includes notes when opted in, truncated to 200 characters', () => {
    const long = 'a'.repeat(500);
    const text = buildCoachContext(input({ includeNotes: true, checkIns: [ci('2026-10-30', { notes: long })] }));
    const m = text.match(/note: "([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toHaveLength(200);
    expect(m![1].endsWith('…')).toBe(true);
    expect(buildCoachContext(input({ includeNotes: true }))).toContain('note: "Felt anxious before the lab report"');
  });

  it('stays within the length cap by dropping the oldest check-ins first', () => {
    const days = lastNDays(14, today);
    const checkIns = days.map((d) => ci(d, { notes: `note for ${d} `.repeat(30) }));
    const text = buildCoachContext(input({ includeNotes: true, checkIns }));
    expect(text.length).toBeLessThanOrEqual(2500);
    expect(text).toContain(`- ${today}:`);
    expect(text).not.toContain(`- ${days[0]}:`);
    expect(text).toMatch(/older check-in\(s\) omitted for length/);
  });

  it('lists exams within 30 days with days until, soonest first', () => {
    const text = buildCoachContext(
      input({
        exams: [
          { title: 'Calculus final', dateKey: '2026-11-05', kind: 'exam' },
          { title: 'Essay', dateKey: '2026-11-01', kind: 'deadline' },
          { title: 'Far away', dateKey: '2026-12-15', kind: 'exam' },
          { title: 'Already done', dateKey: '2026-10-20', kind: 'exam' },
        ],
      }),
    );
    expect(text).toContain('Calculus final (exam) on 2026-11-05, in 5 days');
    expect(text).toContain('Essay (deadline) on 2026-11-01, tomorrow');
    expect(text.indexOf('Essay')).toBeLessThan(text.indexOf('Calculus final'));
    expect(text).not.toContain('Far away');
    expect(text).not.toContain('Already done');
  });

  it('has a system prompt with the key guardrails', () => {
    expect(COACH_SYSTEM_PROMPT).toContain('Wren');
    expect(COACH_SYSTEM_PROMPT).toMatch(/180 words/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/Never diagnose/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/medication/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/emergency services/);
  });
});

describe('detectCrisis', () => {
  it.each([
    'I want to kill myself',
    "I've been feeling SUICIDAL lately",
    'sometimes I just want to die',
    'I keep thinking about self-harm',
    'thinking of self harm again',
    'i cut myself last night',
    'there is no reason to live',
    'everyone would be better off dead without me… I mean I would be',
    'I could take an overdose',
    'I want to end my life',
  ])('flags urgent: %s', (text) => {
    expect(detectCrisis(text).level).toBe('urgent');
  });

  it.each([
    'I feel completely hopeless about this term',
    'I can’t go on like this',
    'cant go on',
    'I feel worthless',
    'had a panic attack before the exam',
    "I can't cope with the workload",
    'I am breaking down',
    'nobody cares about me',
  ])('flags concern: %s', (text) => {
    expect(detectCrisis(text).level).toBe('concern');
  });

  it.each([
    'this exam is killing me',
    'I could die of embarrassment',
    'my phone battery is dead',
    'I need help planning my revision',
    '',
  ])('does not flag figures of speech or ordinary messages: %s', (text) => {
    expect(detectCrisis(text)).toEqual({ level: 'none', matched: [] });
  });

  it('reports matched phrases, urgent taking precedence', () => {
    const r = detectCrisis('I feel hopeless and want to hurt myself');
    expect(r.level).toBe('urgent');
    expect(r.matched).toEqual(['hurt myself', 'hopeless']);
  });

  it('has a crisis message that points to real help', () => {
    expect(CRISIS_MESSAGE).toContain('findahelpline.com');
    expect(CRISIS_MESSAGE).toMatch(/emergency number/);
    expect(CRISIS_MESSAGE).toMatch(/counselling/);
    expect(CRISIS_MESSAGE).toMatch(/someone you trust/);
  });
});
