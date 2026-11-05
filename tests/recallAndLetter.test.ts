import { describe, expect, it } from '@jest/globals';

import type { JournalAnalysis } from '@/features/journal/analysis';
import { escapeHtml, journalToHtml, journalToMarkdown } from '@/features/journal/exportJournal';
import { onThisDay, searchEntries, snippetFor, type RecallEntry } from '@/features/journal/recall';
import { buildWeekLetter, LETTER_MIN_DAYS } from '@/features/journal/weekLetter';
import { checkInActions, planReminders, urlForResponse } from '@/features/reminders/schedule';
import { DEFAULT_PREFERENCES } from '@/types/domain';

const analysis = (over: Partial<JournalAnalysis> = {}): JournalAnalysis => ({
  emotions: [], sentiment: 0, triggers: [], reflection: '', distress: 'none', source: 'local', model: null, ...over,
} as JournalAnalysis);

let nextId = 1;
const entry = (dateKey: string, plain: string, over: Partial<RecallEntry> = {}): RecallEntry => ({
  id: nextId++, dateKey, plain, prompt: null, tags: [], analysis: null, ...over,
});

describe('journal search', () => {
  const entries = [
    entry('2026-10-30', 'Studied for the chemistry exam all evening. Felt calmer after a walk.', { tags: ['exams', 'study'] }),
    entry('2026-10-20', 'Dinner with Maya and Sam. Laughed a lot.', { tags: ['friends'], analysis: analysis({ emotions: [{ name: 'joyful', intensity: 2 }], triggers: [{ phrase: 'time with friends', valence: 'positive' }] } as Partial<JournalAnalysis>) }),
    entry('2026-09-02', 'Café visit, résumé done.', { prompt: 'What did you finish today?' }),
  ];

  it('needs every term to match, ignoring case and accents', () => {
    expect(searchEntries(entries, 'CHEMISTRY walk').map((h) => h.entry.dateKey)).toEqual(['2026-10-30']);
    expect(searchEntries(entries, 'cafe resume').map((h) => h.entry.dateKey)).toEqual(['2026-09-02']);
    expect(searchEntries(entries, 'chemistry maya')).toHaveLength(0);
  });

  it('matches #tags against tags only, and plain words against feelings, triggers and prompts', () => {
    expect(searchEntries(entries, '#friends').map((h) => h.entry.dateKey)).toEqual(['2026-10-20']);
    expect(searchEntries(entries, '#exam').map((h) => h.entry.dateKey)).toEqual(['2026-10-30']);
    expect(searchEntries(entries, 'joyful').map((h) => h.entry.dateKey)).toEqual(['2026-10-20']);
    expect(searchEntries(entries, 'finish').map((h) => h.entry.dateKey)).toEqual(['2026-09-02']);
    expect(searchEntries(entries, '   ')).toEqual([]);
  });

  it('gives a snippet around the first text match, or null when only metadata matched', () => {
    const long = `${'a '.repeat(80)}the word target sits here ${'b '.repeat(80)}`;
    const s = snippetFor(long, ['target']);
    expect(s).toContain('target');
    expect(s?.startsWith('…')).toBe(true);
    expect(s?.endsWith('…')).toBe(true);
    expect(searchEntries(entries, '#friends')[0].snippet).toBeNull();
  });
});

describe('on this day', () => {
  it('finds entries a year, a month and a week ago, oldest first, skipping empty days', () => {
    const list = [entry('2025-10-31', 'Last year'), entry('2026-09-30', 'Not the same day'), entry('2026-10-24', 'Last week'), entry('2026-10-24', '   ')];
    const found = onThisDay(list, '2026-10-31');
    expect(found.map((f) => f.label)).toEqual(['A year ago today', 'A week ago today']);
    expect(found[1].entries).toHaveLength(1);
  });

  it('skips a month-ago date that does not exist instead of rolling over', () => {
    const list = [entry('2026-03-03', 'rolled'), entry('2026-02-28', 'end of Feb')];
    expect(onThisDay(list, '2026-03-31').map((f) => f.label)).toEqual([]);
    expect(onThisDay([entry('2025-12-31', 'NYE')], '2026-01-31').map((f) => f.label)).toEqual(['A month ago today']);
  });
});

describe('weekly letter', () => {
  const base = { today: '2026-11-01', practices: [], sleepGoalHours: 8 };

  it(`waits until ${LETTER_MIN_DAYS} days in the last week have something logged`, () => {
    const checkIns = [{ dateKey: '2026-10-31', mood: 4, sleepHours: 7 }, { dateKey: '2026-10-30', mood: 3, sleepHours: 7 }, { dateKey: '2026-10-20', mood: 3, sleepHours: 7 }];
    expect(buildWeekLetter({ ...base, checkIns, journal: [] })).toBeNull();
  });

  it('is built only from what was logged, and its facts carry no entry text', () => {
    const checkIns = [
      { dateKey: '2026-10-27', mood: 2, sleepHours: 5 }, { dateKey: '2026-10-28', mood: 2, sleepHours: 5.5 },
      { dateKey: '2026-10-30', mood: 4, sleepHours: 8 }, { dateKey: '2026-11-01', mood: 5, sleepHours: 8.5 },
    ];
    const journal = [{ dateKey: '2026-10-29', text: 'SECRET private sentence about my exam', analysis: analysis({ emotions: [{ name: 'anxious', intensity: 2 }], sentiment: -0.4, triggers: [{ phrase: 'exam stress', valence: 'negative' }] } as Partial<JournalAnalysis>) }];
    const letter = buildWeekLetter({ ...base, checkIns, journal, practices: [{ dateKey: '2026-10-31', kind: 'breathing', seconds: 120 }] });
    expect(letter).not.toBeNull();
    expect(letter!.daysLogged).toBe(5);
    const text = letter!.paragraphs.join(' ');
    expect(text).toContain('checked in on 4 days');
    expect(text).toContain('3.3 out of 5');
    expect(text).toContain('Sunday felt brightest');
    expect(text).toContain('under your 8-hour goal');
    expect(text).toContain('longer nights tended to feel better');
    expect(text).toContain('1 breathing break');
    expect(text).toMatch(/exam stress weighed on you/i);
    expect(letter!.facts.join(' ')).not.toContain('SECRET');
  });
});

describe('journal export', () => {
  const entries = [
    { dateKey: '2026-10-31', body: '# Big day\nIt went **well** <3', prompt: 'How was it?', tags: ['exams'], analysis: analysis({ emotions: [{ name: 'proud', intensity: 2 }] } as Partial<JournalAnalysis>) },
    { dateKey: '2026-10-01', body: 'First entry', prompt: null, tags: [], analysis: null },
  ];

  it('writes Markdown oldest first with feelings and tags', () => {
    const md = journalToMarkdown(entries, '2026-11-01');
    expect(md.indexOf('First entry')).toBeLessThan(md.indexOf('Big day'));
    expect(md).toContain('*How was it?*');
    expect(md).toContain('Feelings: Proud · Tags: #exams');
    expect(md).toContain('2 entries');
  });

  it('escapes entry text in the PDF HTML and renders formatting', () => {
    const html = journalToHtml(entries, '2026-11-01');
    expect(html).toContain('<b>well</b> &lt;3');
    expect(html).not.toContain('<3');
    expect(html).toContain('<h3 class="t">Big day</h3>');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});

describe('check-in reminder actions', () => {
  it('offers five moods on iOS and three on Android', () => {
    expect(checkInActions('ios').map((a) => a.buttonTitle)).toEqual(['Rough', 'Low', 'Okay', 'Good', 'Great']);
    expect(checkInActions('android').map((a) => a.identifier)).toEqual(['mood-2', 'mood-3', 'mood-4']);
  });

  it('routes a mood button to the check-in with that mood, and plain taps to the reminder url', () => {
    expect(urlForResponse('mood-4', '/checkin')).toBe('/checkin?mood=4');
    expect(urlForResponse('expo.modules.notifications.actions.DEFAULT', '/breathing')).toBe('/breathing');
    expect(urlForResponse('mood-9', 'https://evil.example')).toBeNull();
  });

  it('attaches the mood buttons to the daily check-in reminder only', () => {
    const plan = planReminders({ ...DEFAULT_PREFERENCES, checkInReminder: true, windDownReminder: true, examReminders: false }, []);
    expect(plan.find((r) => r.id === 'checkin')?.category).toBe('checkin');
    expect(plan.find((r) => r.id === 'winddown')?.category).toBeUndefined();
  });
});
