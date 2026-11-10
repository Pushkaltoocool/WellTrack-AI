/**
 * Transparent, deterministic recommendation engine.
 *
 * Every rule reads only data the user actually provided (check-ins, live tracking
 * sessions, preferences) and returns the evidence that triggered it. Thresholds are
 * general wellness guidance, not clinical cut-offs, and recommendations never promise
 * an outcome.
 */
import { parseDateKey } from '@/lib/dates';
import type { CheckIn, Preferences, Recommendation } from '@/types/domain';

export interface RecommendationContext {
  todayKey: string;
  /** Check-ins from the last 14 days, oldest first. */
  checkIns: CheckIn[];
  /** Live (non-replay) tracking totals for today, seconds. */
  todayActivity: { trackedSeconds: number; activeSeconds: number; sedentarySeconds: number };
  prefs: Preferences;
  /** Upcoming exams and deadlines (today onwards). */
  exams?: { title: string; dateKey: string }[];
  /** Journal: distinct days in the last 7 whose entries read heavy, and the most frequent heavy feelings. */
  journal?: { heavyDays: number; feelings: string[] } | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const daysUntil = (from: string, to: string) => Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / 86_400_000);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function generateRecommendations(ctx: RecommendationContext): Recommendation[] {
  const recs: Recommendation[] = [];
  const sorted = [...ctx.checkIns].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const today = sorted.find((c) => c.dateKey === ctx.todayKey) ?? null;
  const latest = sorted[sorted.length - 1] ?? null;
  const last7 = sorted.slice(-7);
  const last5 = sorted.slice(-5);

  if (!today) {
    recs.push({
      ruleId: 'checkin-missing',
      category: 'general',
      priority: 60,
      title: "Log today's check-in",
      body: 'A 1-minute check-in lets Wren tailor suggestions to how your day is actually going.',
      evidence: latest ? `Your last check-in was on ${latest.dateKey}.` : 'No check-ins recorded yet.',
      actions: [{ kind: 'navigate', label: 'Start check-in', route: '/checkin' }],
    });
  }

  if (latest) {
    // --- sleep ---
    const sleepAvg = avg(last7.map((c) => c.sleepHours));
    const sleepTarget = Math.min(ctx.prefs.sleepGoalHours, 9);
    if (latest.sleepHours < 7 || sleepAvg < 7) {
      recs.push({
        ruleId: 'sleep-low',
        category: 'sleep',
        priority: latest.sleepHours < 6 ? 85 : 70,
        title: 'Protect your sleep window',
        body:
          'A consistent bedtime and a short screen-free wind-down are simple habits many students find helpful. ' +
          'General guidance for adults suggests around 7–9 hours.',
        evidence: `Latest check-in: ${round1(latest.sleepHours)} h sleep. Average over your last ${last7.length} check-in${last7.length === 1 ? '' : 's'}: ${round1(sleepAvg)} h (your goal: ${sleepTarget} h).`,
        actions: [
          {
            kind: 'goal',
            label: 'Set a consistent bedtime',
            goal: {
              title: 'Consistent bedtime',
              description: 'Go to bed within 30 minutes of the same time each night.',
              category: 'sleep',
            },
          },
          {
            kind: 'goal',
            label: 'Screen-free wind-down',
            goal: {
              title: '30-min screen-free wind-down',
              description: 'Put screens away 30 minutes before bed.',
              category: 'sleep',
            },
          },
        ],
      });
    }

    // --- physical activity (self-reported) ---
    const paAvg = avg(last7.map((c) => c.physicalActivityMinutes));
    if (latest.physicalActivityMinutes < 30 && paAvg < ctx.prefs.activeMinutesGoal) {
      recs.push({
        ruleId: 'movement-low',
        category: 'movement',
        priority: 55,
        title: 'Add a short walk to your day',
        body: 'Even a 10-minute walk between study blocks breaks up long sitting periods. You can track it live.',
        evidence: `You reported ${latest.physicalActivityMinutes} min of physical activity in your latest check-in (recent average ${Math.round(paAvg)} min; goal ${ctx.prefs.activeMinutesGoal} min).`,
        actions: [
          {
            kind: 'goal',
            label: 'Daily 10-minute walk',
            goal: { title: '10-minute walk', description: 'Take at least one 10-minute walk.', category: 'movement' },
          },
          { kind: 'navigate', label: 'Track a walk', route: '/activity' },
        ],
      });
    }

    // --- long study sessions ---
    if (latest.studyHours >= 6) {
      recs.push({
        ruleId: 'study-long',
        category: 'study',
        priority: latest.studyHours >= 9 ? 75 : 60,
        title: 'Schedule breaks into long study days',
        body:
          'Try focused blocks with short breaks (for example 50 min on, 10 min off) and spread demanding tasks across the week.',
        evidence: `You logged ${round1(latest.studyHours)} h of study on ${latest.dateKey}.`,
        actions: [
          { kind: 'navigate', label: 'Open focus timer', route: '/focus' },
          {
            kind: 'goal',
            label: 'Break every 50 min',
            goal: {
              title: 'Study break every 50 minutes',
              description: 'Stand up and move for 5–10 minutes after each focus block.',
              category: 'study',
            },
          },
        ],
      });
    }

    // --- academic pressure ---
    if (latest.academicPressure >= 4) {
      recs.push({
        ruleId: 'pressure-high',
        category: 'stress',
        priority: 72,
        title: 'Break your workload into a plan',
        body:
          'Writing down tomorrow’s top three tasks can make a heavy workload feel more manageable. A short breathing exercise may help you reset.',
        evidence: `You rated academic pressure ${latest.academicPressure}/5 on ${latest.dateKey}.`,
        actions: [
          {
            kind: 'goal',
            label: 'Plan top 3 tasks',
            goal: {
              title: "Plan tomorrow's top 3 tasks",
              description: 'Each evening, write down the three most important tasks for the next day.',
              category: 'study',
            },
          },
          { kind: 'navigate', label: 'Breathing exercise', route: '/breathing' },
          { kind: 'navigate', label: 'Student support', route: '/support' },
        ],
      });
    }

    // --- persistently elevated self-reported stress ---
    const highStressDays = last5.filter((c) => c.stressLevel >= 4).length;
    if ((last5.length >= 3 && highStressDays >= 3) || latest.stressLevel === 5) {
      recs.push({
        ruleId: 'stress-persistent',
        category: 'stress',
        priority: 95,
        title: 'Consider reaching out for support',
        body:
          'You have reported high stress repeatedly. Talking to someone you trust, your university’s counselling or wellbeing service, or a health professional can help. If you ever feel unsafe, contact local emergency services.',
        evidence:
          latest.stressLevel === 5 && highStressDays < 3
            ? `You rated your stress 5/5 on ${latest.dateKey}.`
            : `Stress rated 4/5 or higher on ${highStressDays} of your last ${last5.length} check-ins.`,
        actions: [
          { kind: 'navigate', label: 'Support options', route: '/support' },
          { kind: 'navigate', label: 'Breathing exercise', route: '/breathing' },
        ],
      });
    }

    // --- persistently low mood: point to people, not just techniques ---
    const lowMoodDays = last5.filter((c) => c.mood <= 2).length;
    if (last5.length >= 3 && lowMoodDays >= 3 && highStressDays < 3) {
      recs.push({
        ruleId: 'mood-persistent-low',
        category: 'stress',
        priority: 90,
        title: 'You’ve had a run of low days',
        body:
          'Low mood that sticks around is worth talking about, with a friend, family, your university’s wellbeing service or a doctor. You don’t need a crisis to ask for support. If you ever feel unsafe, contact local emergency services.',
        evidence: `Mood rated 2/5 or lower on ${lowMoodDays} of your last ${last5.length} check-ins.`,
        actions: [
          { kind: 'navigate', label: 'Support options', route: '/support' },
          { kind: 'navigate', label: 'Talk it through with Wren', route: '/coach' },
        ],
      });
    }

    // --- mood ---
    if (latest.mood <= 2 && latest.stressLevel < 5 && lowMoodDays < 3) {
      recs.push({
        ruleId: 'mood-low',
        category: 'stress',
        priority: 65,
        title: 'Take a moment for yourself',
        body: 'A short guided breathing exercise or a few minutes outside can be a gentle reset.',
        evidence: `You rated your mood ${latest.mood}/5 on ${latest.dateKey}.`,
        actions: [{ kind: 'navigate', label: 'Breathing exercise', route: '/breathing' }],
      });
    }

    // --- screen time ---
    if (latest.screenTimeHours >= 6) {
      recs.push({
        ruleId: 'screen-high',
        category: 'screen',
        priority: 45,
        title: 'Try a screen-free hour',
        body: 'Swapping one hour of leisure screen time for a walk, a call, or a hobby is an easy experiment.',
        evidence: `You reported ${round1(latest.screenTimeHours)} h of leisure screen time on ${latest.dateKey}.`,
        actions: [
          {
            kind: 'goal',
            label: 'Screen-free hour',
            goal: { title: 'One screen-free hour', description: 'Spend one leisure hour away from screens.', category: 'screen' },
          },
        ],
      });
    }

    // --- social time ---
    const lowSocial = last5.filter((c) => c.socialHours < 1).length;
    if (last5.length >= 3 && lowSocial >= 3) {
      recs.push({
        ruleId: 'social-low',
        category: 'social',
        priority: 40,
        title: 'Make time to connect',
        body: 'A short coffee, call or study session with a friend counts.',
        evidence: `Less than 1 h of social time on ${lowSocial} of your last ${last5.length} check-ins.`,
        actions: [
          {
            kind: 'goal',
            label: 'Connect with someone',
            goal: { title: 'Connect with a friend', description: 'Message, call or meet someone you like.', category: 'social' },
          },
        ],
      });
    }
  }

  // --- exams and deadlines in the next few days ---
  const upcoming = (ctx.exams ?? [])
    .map((e) => ({ ...e, days: daysUntil(ctx.todayKey, e.dateKey) }))
    .filter((e) => e.days >= 0 && e.days <= 3)
    .sort((a, b) => a.days - b.days);
  if (upcoming.length) {
    const e = upcoming[0];
    const when = e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : `in ${e.days} days`;
    const shortSleep = latest && latest.sleepHours < 7;
    recs.push({
      ruleId: 'exam-soon',
      category: 'study',
      priority: e.days <= 1 ? 88 : 78,
      title: e.days === 0 ? 'You’ve got this today' : 'Steady preparation beats late nights',
      body:
        e.days === 0
          ? 'Eat something, arrive a little early, and take three slow breaths before you start.'
          : 'Review in short focused blocks with real breaks, and keep a regular bedtime. Sleep helps you remember what you studied.',
      evidence:
        `${e.title} is ${when}${upcoming.length > 1 ? ` (plus ${upcoming.length - 1} more date${upcoming.length > 2 ? 's' : ''} this week)` : ''}.` +
        (shortSleep ? ` Your latest check-in had ${round1(latest.sleepHours)} h of sleep.` : ''),
      actions:
        e.days === 0
          ? [{ kind: 'navigate', label: 'Calm breathing', route: '/breathing' }]
          : [
              { kind: 'navigate', label: 'Start a focus block', route: '/focus' },
              {
                kind: 'goal',
                label: 'Review in 25-min blocks',
                goal: { title: 'Focused review blocks', description: 'Study in 25-minute blocks with 5-minute breaks.', category: 'study' },
              },
            ],
    });
  }

  // --- journal entries have read heavy on several recent days ---
  if (ctx.journal && ctx.journal.heavyDays >= 3) {
    const feelings = ctx.journal.feelings.slice(0, 2).join(' and ');
    recs.push({
      ruleId: 'journal-heavy',
      category: 'stress',
      priority: 84,
      title: 'Go gently this week',
      body: 'A few slow minutes, a walk outside or a chat with someone you trust can take the edge off. If it keeps feeling this heavy, campus support is there for exactly this.',
      evidence: `Your journal read heavy on ${ctx.journal.heavyDays} of the last 7 days${feelings ? `, mostly ${feelings}` : ''}.`,
      actions: [
        { kind: 'navigate', label: 'Slow breathing', route: '/breathing' },
        { kind: 'navigate', label: 'Support options', route: '/support' },
      ],
    });
  }

  // --- live tracking: long sedentary time today ---
  const sedMin = ctx.todayActivity.sedentarySeconds / 60;
  if (sedMin >= 45 && ctx.todayActivity.activeSeconds < ctx.todayActivity.sedentarySeconds * 0.15) {
    recs.push({
      ruleId: 'sedentary-tracked',
      category: 'movement',
      priority: 68,
      title: 'Time for a movement break',
      body: 'Stand up, stretch, or walk for a few minutes.',
      evidence: `Your tracked sessions today recognised ${Math.round(sedMin)} min of sitting/lying and ${Math.round(ctx.todayActivity.activeSeconds / 60)} min of walking.`,
      actions: [{ kind: 'navigate', label: 'Track a walk', route: '/activity' }],
    });
  }

  if (latest && recs.filter((r) => r.ruleId !== 'checkin-missing').length === 0) {
    recs.push({
      ruleId: 'balanced',
      category: 'general',
      priority: 10,
      title: 'Your recent check-ins look balanced',
      body: 'Nothing in your latest entries crossed our suggestion thresholds. Keep logging to spot trends early.',
      evidence: `Based on ${last7.length} check-in${last7.length === 1 ? '' : 's'} in the last 14 days.`,
      actions: [],
    });
  }

  return recs.sort((a, b) => b.priority - a.priority);
}
