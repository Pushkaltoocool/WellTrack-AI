import { describe, expect, it } from '@jest/globals';

import { bucketize, mean, moodHeadline, periodFor } from '@/features/analytics/periods';
import { localDeeperQuestion } from '@/features/journal/deeper';
import { blockAt, parseLine, parseTags, setBlock, stripMarkdown, toggleInline } from '@/features/journal/markdown';
import { morePrompts, promptForDay, JOURNAL_PROMPTS } from '@/features/journal/prompts';
import { generateRecommendations } from '@/features/wellness/recommendationEngine';
import { dayStreak, weekOf } from '@/lib/streak';
import { DEFAULT_PREFERENCES } from '@/types/domain';

describe('trend periods', () => {
  it('builds a calendar year with 12 month buckets and finds the current month', () => {
    const p = periodFor('year', 0, '2026-10-31');
    expect(p.from).toBe('2026-01-01');
    expect(p.to).toBe('2026-12-31');
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[1]).toEqual({ from: '2026-02-01', to: '2026-02-28', label: 'F' });
    expect(p.currentBucket).toBe(9);
    expect(p.title).toBe('This year');
    expect(periodFor('year', -1, '2026-10-31').title).toBe('Last year');
    expect(periodFor('year', -2, '2026-10-31').title).toBe('2024');
  });

  it('builds months with one bucket per day, across year boundaries', () => {
    const p = periodFor('month', -10, '2026-10-31');
    expect(p.from).toBe('2025-12-01');
    expect(p.to).toBe('2025-12-31');
    expect(p.buckets).toHaveLength(31);
    expect(p.subtitle).toBe('December 2025');
    expect(p.currentBucket).toBe(-1);
    expect(periodFor('month', -8, '2026-10-31').buckets).toHaveLength(28); // Feb 2026
  });

  it('builds Sunday-to-Saturday weeks', () => {
    const p = periodFor('week', 0, '2026-10-31'); // a Saturday
    expect(p.from).toBe('2026-10-25');
    expect(p.to).toBe('2026-10-31');
    expect(p.buckets.map((b) => b.label).join('')).toBe('SMTWTFS');
    expect(p.currentBucket).toBe(6);
    expect(periodFor('week', -1, '2026-10-31').from).toBe('2026-10-18');
  });

  it('bucketizes rows and leaves empty buckets null (never zero)', () => {
    const p = periodFor('year', 0, '2026-10-31');
    const rows = [{ dateKey: '2026-01-05', mood: 2 }, { dateKey: '2026-01-20', mood: 4 }, { dateKey: '2026-03-01', mood: 5 }];
    const v = bucketize(rows, p.buckets, (rs) => mean(rs.map((r) => r.mood)));
    expect(v[0]).toBe(3);
    expect(v[1]).toBeNull();
    expect(v[2]).toBe(5);
  });

  it('describes average mood in words', () => {
    expect(moodHeadline(null)).toBe('Nothing logged yet');
    expect(moodHeadline(2.3)).toBe('A heavier stretch');
    expect(moodHeadline(4.5)).toBe('A bright stretch');
  });
});

describe('journal formatting', () => {
  it('parses block prefixes and inline marks', () => {
    const l = parseLine('## A **bold** and *soft* ~~gone~~ __under__ day');
    expect(l.block).toBe('heading');
    expect(l.prefix).toBe('## ');
    const visible = l.spans.filter((s) => !s.marker);
    expect(visible.find((s) => s.bold)?.text).toBe('bold');
    expect(visible.find((s) => s.italic)?.text).toBe('soft');
    expect(visible.find((s) => s.strike)?.text).toBe('gone');
    expect(visible.find((s) => s.underline)?.text).toBe('under');
    // Rendering every span (markers included) must reproduce the line exactly, so the editor stays in sync.
    expect(l.prefix + l.spans.map((s) => s.text).join('')).toBe('## A **bold** and *soft* ~~gone~~ __under__ day');
  });

  it('strips formatting for analysis and previews', () => {
    expect(stripMarkdown('# Title\n> quoted **bold**\nplain *it*')).toBe('Title\nquoted bold\nplain it');
  });

  it('sets and clears a line’s block style, keeping the cursor on the line', () => {
    const text = 'first\nsecond line\nthird';
    const r = setBlock(text, 9, 'title');
    expect(r.text).toBe('first\n# second line\nthird');
    expect(blockAt(r.text, r.cursor)).toBe('title');
    const back = setBlock(r.text, r.cursor, 'body');
    expect(back.text).toBe(text);
  });

  it('wraps, unwraps and inserts inline marks', () => {
    const w = toggleInline('I feel calm today', { start: 7, end: 11 }, 'bold');
    expect(w.text).toBe('I feel **calm** today');
    expect(w.selection).toEqual({ start: 9, end: 13 });
    const u = toggleInline(w.text, w.selection, 'bold');
    expect(u.text).toBe('I feel calm today');
    const empty = toggleInline('ab', { start: 1, end: 1 }, 'strike');
    expect(empty).toEqual({ text: 'a~~~~b', selection: { start: 3, end: 3 } });
  });

  it('normalises tags', () => {
    expect(parseTags(' Exams,#friends,exams, ,Sleep')).toEqual(['exams', 'friends', 'sleep']);
  });
});

describe('prompts, streaks and follow-up questions', () => {
  it('gives a stable prompt per day and different extra prompts', () => {
    expect(promptForDay('2026-10-31')).toBe(promptForDay('2026-10-31'));
    expect(JOURNAL_PROMPTS).toContain(promptForDay('2026-10-31'));
    const more = morePrompts('2026-10-31', 6);
    expect(more).not.toContain(promptForDay('2026-10-31'));
    expect(new Set(more).size).toBe(6);
  });

  it('counts consecutive days and does not reset before today’s entry', () => {
    expect(dayStreak(['2026-10-29', '2026-10-30', '2026-10-31'], '2026-10-31')).toBe(3);
    expect(dayStreak(['2026-10-29', '2026-10-30'], '2026-10-31')).toBe(2);
    expect(dayStreak(['2026-10-28', '2026-10-30'], '2026-10-31')).toBe(1);
    expect(dayStreak([], '2026-10-31')).toBe(0);
    expect(weekOf('2026-10-28')[0]).toBe('2026-10-25');
  });

  it('asks a supportive question for heavy text and an opening one for empty text', () => {
    expect(['What would you say to a friend who felt exactly this way?', 'What’s one small thing that could make the next hour a little easier?', 'Underneath this feeling, what are you most worried about?', 'What part of this is in your control, and what isn’t?', 'When have you got through something like this before? What helped?'])
      .toContain(localDeeperQuestion('I am so stressed about tomorrow'));
    expect(localDeeperQuestion('')).toMatch(/\?$/);
  });
});

describe('journal-heavy suggestion', () => {
  const base = { todayKey: '2026-10-31', checkIns: [], todayActivity: { trackedSeconds: 0, activeSeconds: 0, sedentarySeconds: 0 }, prefs: DEFAULT_PREFERENCES };
  it('appears with evidence when 3+ recent days read heavy', () => {
    const r = generateRecommendations({ ...base, journal: { heavyDays: 3, feelings: ['stressed', 'tired'] } }).find((x) => x.ruleId === 'journal-heavy');
    expect(r?.evidence).toBe('Your journal read heavy on 3 of the last 7 days, mostly stressed and tired.');
    expect(r?.actions.some((a) => a.route === '/support')).toBe(true);
  });
  it('stays quiet below the threshold or without a journal', () => {
    expect(generateRecommendations({ ...base, journal: { heavyDays: 2, feelings: [] } }).some((x) => x.ruleId === 'journal-heavy')).toBe(false);
    expect(generateRecommendations(base).some((x) => x.ruleId === 'journal-heavy')).toBe(false);
  });
});
