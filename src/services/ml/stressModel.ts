/**
 * Experimental stress-risk model (ml/stress/train_stress.py).
 *
 * IMPORTANT: the only suitable public dataset found has rule-derived labels
 * (see docs/STRESS_DATASET.md). The exported tree reproduces that rule on study and
 * sleep hours; it is shown in the app as an experimental dataset-based estimate only.
 */
import stressModelJson from '../../../models/stress_model.json';
import type { CheckIn, RiskLevel } from '@/types/domain';

import { predictScores, type ExportedModelBase } from './inference';

export interface StressModel extends ExportedModelBase {
  featureUnits: Record<string, string>;
  appInputMapping: Record<string, string>;
  featureRanges: Record<string, [number, number]>;
  dataset: { name: string; source: string; license: string; samples: number; labelProvenance: string };
  limitations: string[];
}

export const STRESS_MODEL = stressModelJson as unknown as StressModel;

/** Maps each model feature to the check-in field it is read from (no transforms). */
const FIELD_FOR_FEATURE: Record<string, { field: keyof CheckIn; label: string }> = {
  Study_Hours_Per_Day: { field: 'studyHours', label: 'Study hours' },
  Sleep_Hours_Per_Day: { field: 'sleepHours', label: 'Sleep hours' },
};

export interface StressInput {
  feature: string;
  label: string;
  value: number;
  unit: string;
  range: [number, number];
  outOfRange: boolean;
}

export interface StressPrediction {
  modelId: string;
  predicted: RiskLevel;
  /** Leaf class distribution. Leaves are pure, so this is 0/1 and must not be shown as confidence. */
  scores: Record<string, number>;
  inputs: StressInput[];
  anyOutOfRange: boolean;
}

export function stressInputsFromCheckIn(c: CheckIn): StressInput[] {
  return STRESS_MODEL.featureNames.map((f) => {
    const map = FIELD_FOR_FEATURE[f];
    if (!map) throw new Error(`stress model feature ${f} has no app mapping`);
    const value = c[map.field] as number;
    const range = STRESS_MODEL.featureRanges[f] ?? [-Infinity, Infinity];
    return {
      feature: f,
      label: map.label,
      value,
      unit: STRESS_MODEL.featureUnits[f] ?? '',
      range,
      outOfRange: value < range[0] || value > range[1],
    };
  });
}

export function predictStress(c: CheckIn): StressPrediction {
  const inputs = stressInputsFromCheckIn(c);
  const res = predictScores(STRESS_MODEL, inputs.map((i) => i.value));
  const scores: Record<string, number> = {};
  STRESS_MODEL.classes.forEach((cls, i) => (scores[cls] = res.scores[i]));
  return {
    modelId: STRESS_MODEL.modelId,
    predicted: res.label as RiskLevel,
    scores,
    inputs,
    anyOutOfRange: inputs.some((i) => i.outOfRange),
  };
}

/** Plain-language description of the decision rule the model learned (from the exported tree). */
export const STRESS_RULE_SUMMARY =
  'High if study > 8 h or sleep < 6 h; otherwise Low if study < 6 h; otherwise Moderate.';
