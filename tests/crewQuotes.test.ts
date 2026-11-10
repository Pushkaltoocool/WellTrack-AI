import { describe, expect, it } from '@jest/globals';

import { crewTimeline, promptFor, slotAt, speakerForHour } from '@/features/widgets/crewQuotes';

const at = (h: number) => new Date(2026, 10, 10, h, 0, 0).getTime();

describe('crew widget timeline', () => {
  it('gives each part of the day to its companion', () => {
    expect(speakerForHour(8)).toBe('pika');
    expect(speakerForHour(14)).toBe('char');
    expect(speakerForHour(20)).toBe('wren');
    expect(speakerForHour(23)).toBe('night');
    expect(speakerForHour(3)).toBe('night');
  });

  it('sleeps at night and is stable for the same slot', () => {
    const night = slotAt(at(2));
    expect(night.pose).toBe('sleep');
    expect(slotAt(at(2))).toEqual(night);
  });

  it('schedules two-hour slots from the current block for three days', () => {
    const t = crewTimeline(at(9) + 25 * 60_000);
    expect(new Date(t[0].at).getHours()).toBe(8);
    expect(t).toHaveLength(37);
    expect(t[1].at - t[0].at).toBe(2 * 3_600_000);
    expect(new Set(t.map((s) => s.speaker))).toEqual(new Set(['pika', 'char', 'wren', 'crew']));
  });

  it('builds a signed journal prompt', () => {
    expect(promptFor({ quote: 'Breaks are fuel, not failure.', speaker: 'char' })).toBe('“Breaks are fuel, not failure.” — Char');
  });
});
