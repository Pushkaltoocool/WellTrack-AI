/** Orchestrates one coach turn: store the user's message, build context, call the LLM, store the reply. */
import { addDays } from '@/lib/dates';
import { chatCompletion, type ChatMessage } from '@/services/ai/llm';
import type { Db } from '@/services/database/db';
import { addCoachMessage, listCoachMessages, listExams, listGoals } from '@/services/database/repositories';
import type { Preferences } from '@/types/domain';

import { loadInsights } from '../insights/insightsService';
import { journalSummaryForCoach } from '../journal/journalInsights';
import { loadJournal, toInsightEntries } from '../journal/journalService';
import { buildCoachContext, COACH_SYSTEM_PROMPT } from './context';

export const WEEKLY_PROMPT = 'Reflect on my week with me: what went well, what was hard, and one small thing to try next week.';

/** Prior turns sent with each request (keeps requests small and cheap). */
const HISTORY_TURNS = 12;

export async function buildContextForCoach(db: Db, prefs: Preferences, today: string): Promise<string> {
  const [insights, goals, exams, journal] = await Promise.all([
    loadInsights(db, prefs, today), listGoals(db, 'active'), listExams(db, today), loadJournal(db, addDays(today, -13), today),
  ]);
  // Feeling names, counts and short trigger phrases only — never journal text.
  const journalLine = journalSummaryForCoach(toInsightEntries(journal), today);
  const context = buildCoachContext({
    today,
    displayName: prefs.displayName,
    prefs,
    checkIns: insights.checkIns.filter((c) => c.dateKey >= addDays(today, -13)),
    includeNotes: prefs.coachIncludeNotes,
    recap: insights.recap,
    patterns: insights.patterns.patterns,
    goals: goals.map((g) => ({ title: g.title, completedToday: g.completedToday, streak: g.streak })),
    exams: exams.map((e) => ({ title: e.title, dateKey: e.dateKey, kind: e.kind })),
    todaySteps: insights.todaySteps,
  });
  return journalLine ? `${context}\n${journalLine}` : context;
}

export async function sendCoachMessage(
  db: Db,
  prefs: Preferences,
  today: string,
  /** The new message, or null to retry an unanswered last message. */
  text: string | null,
  opts: { idToken?: string | null; signal?: AbortSignal } = {},
): Promise<void> {
  if (text !== null) await addCoachMessage(db, { role: 'user', content: text.trim() });
  const [context, history] = await Promise.all([buildContextForCoach(db, prefs, today), listCoachMessages(db, HISTORY_TURNS)]);
  const messages: ChatMessage[] = [
    { role: 'system', content: COACH_SYSTEM_PROMPT },
    { role: 'system', content: `Today is ${today}.\n${context}` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const reply = await chatCompletion(messages, opts);
  await addCoachMessage(db, { role: 'assistant', content: reply.content, model: reply.model });
}
