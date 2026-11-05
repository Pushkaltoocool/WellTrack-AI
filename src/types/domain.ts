/** Shared domain types for WellTrack AI. */

export const HAR_CLASSES = [
  'WALKING',
  'WALKING_UPSTAIRS',
  'WALKING_DOWNSTAIRS',
  'SITTING',
  'STANDING',
  'LAYING',
] as const;
export type ActivityClass = (typeof HAR_CLASSES)[number];

export const ACTIVITY_LABELS: Record<ActivityClass, string> = {
  WALKING: 'Walking',
  WALKING_UPSTAIRS: 'Walking upstairs',
  WALKING_DOWNSTAIRS: 'Walking downstairs',
  SITTING: 'Sitting',
  STANDING: 'Standing',
  LAYING: 'Lying down',
};

/** Active = locomotion classes. Sedentary = sitting + lying. Standing is tracked separately. */
export const ACTIVE_CLASSES: readonly ActivityClass[] = ['WALKING', 'WALKING_UPSTAIRS', 'WALKING_DOWNSTAIRS'];
export const SEDENTARY_CLASSES: readonly ActivityClass[] = ['SITTING', 'LAYING'];

export type ActivityDurations = Record<ActivityClass, number>; // seconds

export function emptyDurations(): ActivityDurations {
  return { WALKING: 0, WALKING_UPSTAIRS: 0, WALKING_DOWNSTAIRS: 0, SITTING: 0, STANDING: 0, LAYING: 0 };
}

/** Where a tracking session's samples came from. Replay sessions never count toward personal stats. */
export type SessionSource = 'live' | 'replay';

export interface ActivitySession {
  id: number;
  source: SessionSource;
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  dateKey: string; // local YYYY-MM-DD of start
  trackedSeconds: number; // seconds with a classified window
  durations: ActivityDurations;
  windowCount: number;
  steps: number | null; // null = pedometer unavailable
  modelId: string;
  replaySequence: string | null;
  meanSampleRateHz: number | null;
}

export interface CheckIn {
  id: number;
  dateKey: string;
  sleepHours: number;
  studyHours: number;
  academicPressure: number; // 1-5
  screenTimeHours: number;
  physicalActivityMinutes: number;
  socialHours: number;
  extracurricularHours: number;
  stressLevel: number; // 1-5 self-reported
  mood: number; // 1-5
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export type CheckInInput = Omit<CheckIn, 'id' | 'createdAt' | 'updatedAt'>;

export type RiskLevel = 'Low' | 'Moderate' | 'High';

export interface StressAssessment {
  id: number;
  dateKey: string;
  checkInId: number;
  modelId: string;
  predicted: RiskLevel;
  probabilities: Record<string, number>;
  inputs: Record<string, number>;
  createdAt: number;
}

export type GoalCategory = 'sleep' | 'movement' | 'study' | 'stress' | 'social' | 'screen' | 'general';

export interface Goal {
  id: number;
  title: string;
  description: string;
  category: GoalCategory;
  sourceRecommendationKey: string | null;
  status: 'active' | 'archived';
  createdAt: number;
}

export interface GoalWithProgress extends Goal {
  completedToday: boolean;
  completionsLast7: number;
  streak: number;
}

export type RecommendationStatus = 'new' | 'accepted' | 'completed' | 'dismissed';

export interface RecommendationAction {
  kind: 'goal' | 'navigate';
  label: string;
  route?: string;
  goal?: { title: string; description: string; category: GoalCategory };
}

export interface Recommendation {
  /** Stable rule id, e.g. "sleep-low". */
  ruleId: string;
  category: GoalCategory;
  priority: number; // higher = more important
  title: string;
  body: string;
  /** Human-readable explanation of the user data that triggered the rule. */
  evidence: string;
  actions: RecommendationAction[];
}

export interface StoredRecommendation extends Recommendation {
  id: number;
  dateKey: string;
  status: RecommendationStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Preferences {
  displayName: string;
  onboardingComplete: boolean;
  activeMinutesGoal: number;
  sleepGoalHours: number;
  smoothingEnabled: boolean;
  initialGoals: string[];
  /** iOS only: read all-day step history from Core Motion (opt-in). */
  stepHistoryEnabled: boolean;
  /** Local reminders. Times are "HH:MM" in local time. */
  checkInReminder: boolean;
  checkInReminderTime: string;
  windDownReminder: boolean;
  windDownReminderTime: string;
  examReminders: boolean;
  /** Require biometrics / device passcode when opening the app. */
  appLock: boolean;
  /** Back up to the signed-in account (Firestore). */
  cloudBackup: boolean;
  /** AI coach: when the user consented to sending summarised data to the LLM provider (ms). */
  coachConsentAt: number | null;
  /** AI coach: also share check-in notes. */
  coachIncludeNotes: boolean;
  /** Journal: when the user agreed to send entries to the AI model for emotion analysis (ms); null = on-device only. */
  journalAiConsentAt: number | null;
  /** Read Apple Health (HealthKit) data. Development/App Store builds only. */
  healthKitEnabled: boolean;
  /** Journal editor: larger body text. */
  journalLargeText: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  displayName: '',
  onboardingComplete: false,
  activeMinutesGoal: 30,
  sleepGoalHours: 8,
  smoothingEnabled: true,
  initialGoals: [],
  stepHistoryEnabled: false,
  checkInReminder: false,
  checkInReminderTime: '20:30',
  windDownReminder: false,
  windDownReminderTime: '22:30',
  examReminders: true,
  appLock: false,
  cloudBackup: true,
  coachConsentAt: null,
  coachIncludeNotes: false,
  journalAiConsentAt: null,
  healthKitEnabled: false,
  journalLargeText: false,
};

export type ExamKind = 'exam' | 'assignment' | 'presentation' | 'other';

export interface Exam {
  id: number;
  title: string;
  dateKey: string;
  kind: ExamKind;
  notes: string;
  createdAt: number;
}

export interface JournalEntryRecord {
  id: number;
  dateKey: string;
  title: string;
  body: string;
  /** Guided prompt the entry answered, if any. */
  prompt: string | null;
  /** Comma-separated lower-case tags. */
  tags: string;
  /** Total seconds spent in the editor across sessions. */
  writingSeconds: number;
  /** Serialized emotion analysis (see features/journal/analysis), null until analysed. */
  analysisJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export type PracticeKind = 'breathing' | 'focus';

export interface PracticeSession {
  id: number;
  kind: PracticeKind;
  dateKey: string;
  seconds: number;
  createdAt: number;
}

export interface CoachMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Model that produced an assistant message. */
  model: string | null;
  createdAt: number;
}
