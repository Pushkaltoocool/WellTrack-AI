import type { Ionicons } from '@expo/vector-icons';

import { daysBetween, todayKey } from '@/lib/dates';
import type { ExamKind } from '@/types/domain';

export const EXAM_KINDS: { value: ExamKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'exam', label: 'Exam', icon: 'school-outline' },
  { value: 'assignment', label: 'Assignment', icon: 'document-text-outline' },
  { value: 'presentation', label: 'Presentation', icon: 'easel-outline' },
  { value: 'other', label: 'Other', icon: 'calendar-outline' },
];

export function countdown(key: string, today: string = todayKey()): string {
  const d = daysBetween(today, key);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} ago`;
  return `In ${d} days`;
}
