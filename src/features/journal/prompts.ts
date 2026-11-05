/** Guided journaling prompts. One "prompt of the day" rotates by date so everyone sees a stable prompt all day. */
export const JOURNAL_PROMPTS = [
  'What’s one small thing that went well today?',
  'What’s taking up the most space in your head right now?',
  'What would make tomorrow feel 10% lighter?',
  'Who made your day a little better recently, and how?',
  'What are you avoiding at the moment, and what’s one tiny first step?',
  'When did you feel most like yourself this week?',
  'What’s something you’re proud of that nobody else noticed?',
  'What drained your energy today? What gave some back?',
  'If a friend were in your exact situation, what would you tell them?',
  'What’s one worry you can let go of tonight, even just until morning?',
  'What did you learn about yourself this week?',
  'Describe a moment today when you felt calm, even briefly.',
  'What are three things you’re grateful for right now?',
  'What would “good enough” look like for your next deadline?',
  'Which feeling showed up most today? Where did you notice it in your body?',
  'What boundary would protect your time or energy this week?',
  'What do you forgive easily in others but not in yourself?',
  'What’s something you’re looking forward to, however small?',
  'What helped you get through a hard moment recently?',
  'How did you take care of your body today?',
  'What would you like to say no to, and what would you say yes to instead?',
  'Write about a place where you feel safe and at ease.',
  'What’s one thing you can control tomorrow?',
  'What did today teach you about what you need?',
] as const;

export function promptForDay(dateKey: string): string {
  let h = 0;
  for (const ch of dateKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return JOURNAL_PROMPTS[h % JOURNAL_PROMPTS.length];
}

/** A few prompts after today's, for the prompt picker. */
export function morePrompts(dateKey: string, count = 6): string[] {
  const first = (JOURNAL_PROMPTS as readonly string[]).indexOf(promptForDay(dateKey));
  return Array.from({ length: count }, (_, i) => JOURNAL_PROMPTS[(first + 1 + i * 3) % JOURNAL_PROMPTS.length]);
}
