/**
 * Loads the exported HAR models and classifies 6-channel sensor windows.
 * Two variants are bundled: the full accelerometer+gyroscope model and an
 * accelerometer-only fallback for devices without a gyroscope.
 */
import fullModelJson from '../../../models/har_model.json';
import accModelJson from '../../../models/har_model_acc.json';
import { HAR_CLASSES, type ActivityClass } from '@/types/domain';

import { extractFeatures, featureNames, type SensorWindow } from './harFeatures';
import { predictScores, type ExportedModelBase } from './inference';

export interface HarModel extends ExportedModelBase {
  sensors: string;
  preprocessing: {
    sampleRateHz: number;
    windowSize: number;
    windowStep: number;
    channels: string[];
    accelerometerUnits: string;
    gyroscopeUnits: string;
    filter: string;
  };
  hyperparameters: Record<string, unknown>;
  metrics: {
    test: {
      accuracy: number;
      macroF1: number;
      macroPrecision: number;
      macroRecall: number;
      expectedCalibrationError: number;
      perClass: Record<string, { precision: number; recall: number; f1: number; support: number }>;
      confusionMatrix: number[][];
    };
    comparison: Record<string, { accuracy: number; macroF1: number; cvMacroF1: number }>;
  };
  featureImportanceTop: { feature: string; meanAbsStdCoef: number }[];
}

export const HAR_MODEL = fullModelJson as unknown as HarModel;
export const HAR_MODEL_ACC_ONLY = accModelJson as unknown as HarModel;

const ALL_FEATURES = featureNames();

function columnIndex(model: HarModel): number[] {
  return model.featureNames.map((n) => {
    const i = ALL_FEATURES.indexOf(n);
    if (i < 0) throw new Error(`${model.modelId}: unknown feature ${n}`);
    return i;
  });
}

const COLUMNS = new Map<string, number[]>([
  [HAR_MODEL.modelId, columnIndex(HAR_MODEL)],
  [HAR_MODEL_ACC_ONLY.modelId, columnIndex(HAR_MODEL_ACC_ONLY)],
]);

export function harModelFor(useGyro: boolean): HarModel {
  return useGyro ? HAR_MODEL : HAR_MODEL_ACC_ONLY;
}

export interface HarPrediction {
  label: ActivityClass;
  /** Softmax output of the logistic-regression model, per class in `model.classes` order (a subset of HAR_CLASSES). */
  probabilities: number[];
  modelId: string;
}

export function classifyFeatures(allFeatures: readonly number[], model: HarModel): HarPrediction {
  const cols = COLUMNS.get(model.modelId) ?? columnIndex(model);
  const x = cols.map((c) => allFeatures[c]);
  const res = predictScores(model, x);
  const label = res.label as ActivityClass;
  if (!HAR_CLASSES.includes(label)) throw new Error(`unexpected class ${res.label}`);
  return { label, probabilities: res.scores, modelId: model.modelId };
}

export function classifyWindow(window: SensorWindow, useGyro: boolean): HarPrediction {
  return classifyFeatures(extractFeatures(window), harModelFor(useGyro));
}
