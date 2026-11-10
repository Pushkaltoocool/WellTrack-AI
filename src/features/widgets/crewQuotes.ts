/**
 * What the home-screen widget says through the day. Every line is original, in the companion's
 * voice, encouraging and never medical. The timeline changes every two hours; whoever "owns" that
 * part of the day speaks, and every third slot the whole crew shows up together.
 */
export type Speaker = 'wren' | 'pika' | 'char' | 'crew';
export type Pose = 'idle' | 'cheer' | 'sleep';

export type PoolKey = Speaker | 'night';

/** Every line, by pool. Shipped to the widget so its shuffle button can pick a new one on its own. */
export const QUOTES: Record<PoolKey, readonly string[]> = {
  pika: [
    'Shoes on. The day is better at walking pace.',
    'Ten minutes outside counts. I checked.',
    'Take the stairs. I’ll be right behind you.',
    'Small steps still leave footprints.',
    'Stretch first, then conquer.',
    'You don’t need a run. A wander will do.',
  ],
  char: [
    'Hardest task first. Then everything else is easy.',
    'One focus block. Just one. Then we see.',
    'Breaks are fuel, not failure.',
    'You’ve survived every exam so far.',
    'Start ugly. Fix it later.',
    'Close one tab. Open one page. Begin.',
  ],
  wren: [
    'How did today actually feel?',
    'You don’t have to fix the day. Just notice it.',
    'One true sentence is enough for tonight.',
    'What lifted you today, even a little?',
    'Be as kind to yourself as you’d be to a friend.',
    'Slow evening? Good. Stay there a while.',
  ],
  crew: [
    'We’re cheering for you. Quietly. Mostly.',
    'Whatever today is, you’re not doing it alone.',
    'Move a bit, focus a bit, feel a bit. That’s a good day.',
    'Proud of you for showing up.',
  ],
  night: [
    'Rest is part of the plan.',
    'Phone down. Tomorrow will keep.',
    'Sleep now. We’ll be here in the morning.',
  ],
};

export const SPEAKER_NAMES: Record<Speaker, string> = { wren: 'Wren', pika: 'Pika', char: 'Char', crew: 'Wren, Pika & Char' };

export interface CrewSlot {
  at: number; // epoch ms
  speaker: Speaker;
  pose: Pose;
  quote: string;
  /** The pool the quote came from and its index there (the widget shuffles from this point). */
  pool: PoolKey;
  quoteIndex: number;
  /** Layout variant 0–2: where the main companion stands, so the widget feels alive. */
  scene: number;
}

const SLOT_HOURS = 2;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Who owns an hour of the day. */
export function speakerForHour(h: number): Speaker | 'night' {
  if (h >= 22 || h < 6) return 'night';
  if (h < 12) return 'pika';
  if (h < 18) return 'char';
  return 'wren';
}

export function slotAt(at: number): CrewSlot {
  const d = new Date(at);
  const h = d.getHours();
  const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const index = Math.floor(h / SLOT_HOURS);
  const owner = speakerForHour(h);
  const crewTurn = owner !== 'night' && index % 3 === 1;
  const pool = crewTurn ? 'crew' : owner;
  const lines = QUOTES[pool];
  const quoteIndex = hash(`${dayKey}:${index}:${pool}`) % lines.length;
  const quote = lines[quoteIndex];
  const speaker: Speaker = pool === 'night' ? (index % 2 ? 'wren' : 'crew') : pool;
  const pose: Pose = pool === 'night' ? 'sleep' : hash(`${dayKey}:${index}:pose`) % 3 === 0 ? 'idle' : 'cheer';
  return { at, speaker, pose, quote, pool, quoteIndex, scene: hash(`${dayKey}:${index}:scene`) % 3 };
}

/** Slots from the start of the current two-hour block, for `hours` ahead. */
export function crewTimeline(now: number, hours = 72): CrewSlot[] {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() - (start.getHours() % SLOT_HOURS));
  const out: CrewSlot[] = [];
  for (let t = start.getTime(); t < now + hours * 3_600_000; t += SLOT_HOURS * 3_600_000) out.push(slotAt(t));
  return out;
}

/** The journal prompt the widget opens with: the quote, signed by whoever said it. */
export function promptFor(slot: Pick<CrewSlot, 'quote' | 'speaker'>): string {
  return `“${slot.quote}” — ${SPEAKER_NAMES[slot.speaker]}`;
}
