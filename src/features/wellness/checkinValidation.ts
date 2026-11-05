import type { CheckInInput } from '@/types/domain';

export interface FieldSpec {
  key: keyof CheckInInput;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  /** Shown under the field so users know what is (and isn't) used by the ML model. */
  hint?: string;
}

export const NUMERIC_FIELDS: FieldSpec[] = [
  { key: 'sleepHours', label: 'Sleep last night', unit: 'h', min: 0, max: 16, step: 0.5 },
  { key: 'studyHours', label: 'Study / coursework', unit: 'h', min: 0, max: 16, step: 0.5 },
  { key: 'screenTimeHours', label: 'Leisure screen time', unit: 'h', min: 0, max: 18, step: 0.5 },
  { key: 'physicalActivityMinutes', label: 'Physical activity', unit: 'min', min: 0, max: 300, step: 5, integer: true },
  { key: 'socialHours', label: 'Social time', unit: 'h', min: 0, max: 12, step: 0.5 },
  { key: 'extracurricularHours', label: 'Extracurriculars', unit: 'h', min: 0, max: 12, step: 0.5 },
];

export const SCALE_FIELDS: { key: 'academicPressure' | 'stressLevel' | 'mood'; label: string; low: string; high: string }[] = [
  { key: 'academicPressure', label: 'Academic pressure', low: 'Very light', high: 'Overwhelming' },
  { key: 'stressLevel', label: 'How stressed do you feel?', low: 'Not at all', high: 'Extremely' },
  { key: 'mood', label: 'Overall mood', low: 'Very low', high: 'Great' },
];

export const NOTES_MAX = 500;

export type ValidationErrors = Partial<Record<keyof CheckInInput | 'form', string>>;

export function validateCheckIn(input: CheckInInput): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) errors.dateKey = 'Invalid date';
  for (const f of NUMERIC_FIELDS) {
    const v = input[f.key] as number;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors[f.key] = `${f.label} is required`;
    } else if (v < f.min || v > f.max) {
      errors[f.key] = `${f.label} must be between ${f.min} and ${f.max} ${f.unit}`;
    } else if (f.integer && !Number.isInteger(v)) {
      errors[f.key] = `${f.label} must be a whole number`;
    }
  }
  for (const s of SCALE_FIELDS) {
    const v = input[s.key];
    if (!Number.isInteger(v) || v < 1 || v > 5) errors[s.key] = `Choose a value from 1 to 5`;
  }
  if (input.notes.length > NOTES_MAX) errors.notes = `Notes are limited to ${NOTES_MAX} characters`;
  const committed = input.sleepHours + input.studyHours + input.socialHours + input.extracurricularHours;
  if (Object.keys(errors).length === 0 && committed > 24) {
    errors.form = `Sleep, study, social and extracurricular time add up to ${committed} h — more than 24 h. Please check your entries.`;
  }
  return errors;
}

/** Parses a user-typed number; returns NaN for empty / invalid input. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d*$/.test(t)) return NaN;
  return Number(t);
}
