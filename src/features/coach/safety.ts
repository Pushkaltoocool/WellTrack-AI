/**
 * Lightweight, on-device crisis phrase detection for coach messages. Deliberately simple and
 * conservative: it pattern-matches explicit phrases, so figures of speech like "this exam is
 * killing me" do not trigger. It is a safety net, not a risk assessment.
 */

export type CrisisLevel = 'none' | 'concern' | 'urgent';

const URGENT: [label: string, re: RegExp][] = [
  ['kill myself', /\bkill(?:ing)? myself\b/],
  ['end my life', /\bend(?:ing)? my (?:own )?life\b/],
  ['take my own life', /\btak(?:e|ing) my own life\b/],
  ['end it all', /\bend(?:ing)? it all\b/],
  ['suicide', /\bsuicide\b/],
  ['suicidal', /\bsuicidal\b/],
  ['want to die', /\b(?:want(?:ed)?|wanna) to die\b|\bwanna die\b/],
  ["don't want to live", /\b(?:don'?t|do not) want to (?:live|be alive)\b/],
  ['hurt myself', /\bhurt(?:ing)? myself\b/],
  ['self-harm', /\bself[- ]?harm(?:ing)?\b/],
  ['cut myself', /\bcut(?:ting)? myself\b/],
  ['overdose', /\boverdos(?:e|ed|ing)\b/],
  ['no reason to live', /\bno reason to (?:live|keep living)\b/],
  ['better off dead', /\bbetter off dead\b/],
];

const CONCERN: [label: string, re: RegExp][] = [
  ['hopeless', /\bhopeless(?:ness)?\b/],
  ["can't go on", /\b(?:can'?t|cannot|can not) go on\b/],
  ['worthless', /\bworthless\b/],
  ['panic attack', /\bpanic attacks?\b/],
  ["can't cope", /\b(?:can'?t|cannot|can not) cope\b/],
  ['breaking down', /\bbreaking down\b/],
  ['nobody cares', /\b(?:nobody|no one|no-one) cares\b/],
];

/** Lower-case, unify curly apostrophes, collapse whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ');
}

export function detectCrisis(text: string): { level: CrisisLevel; matched: string[] } {
  const t = normalize(text ?? '');
  const urgent = URGENT.filter(([, re]) => re.test(t)).map(([l]) => l);
  const concern = CONCERN.filter(([, re]) => re.test(t)).map(([l]) => l);
  const level: CrisisLevel = urgent.length ? 'urgent' : concern.length ? 'concern' : 'none';
  return { level, matched: [...urgent, ...concern] };
}

export const CRISIS_MESSAGE =
  "I'm really glad you told me, and I'm sorry things feel this heavy right now. Your safety matters most. " +
  'If you might act on these thoughts or feel unsafe, please call your local emergency number now. ' +
  'You can also talk to a free, confidential crisis line today — findahelpline.com shows the ones in your country. ' +
  "Your campus counselling service is there for this too. And please reach out to someone you trust — a friend, family member or tutor — and let them know how you're feeling. " +
  "You don't have to get through this alone.";
