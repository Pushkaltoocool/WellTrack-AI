import type { Ionicons } from '@expo/vector-icons';

import { activityColors } from '@/theme/tokens';
import { ACTIVITY_LABELS, HAR_CLASSES, type ActivityClass } from '@/types/domain';

export const ACTIVITY_ICONS: Record<ActivityClass, keyof typeof Ionicons.glyphMap> = {
  WALKING: 'walk',
  WALKING_UPSTAIRS: 'trending-up',
  WALKING_DOWNSTAIRS: 'trending-down',
  SITTING: 'laptop-outline',
  STANDING: 'accessibility-outline',
  LAYING: 'bed-outline',
};

export function activityLabel(c: ActivityClass): string {
  return ACTIVITY_LABELS[c];
}

export function activityColor(c: ActivityClass): string {
  return activityColors[c];
}

export const ACTIVITY_LIST = HAR_CLASSES.map((c) => ({
  key: c,
  label: ACTIVITY_LABELS[c],
  color: activityColors[c],
  icon: ACTIVITY_ICONS[c],
}));
