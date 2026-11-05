import { describe, expect, it } from '@jest/globals';
/**
 * Python <-> TypeScript parity for the HAR pipeline. Fixtures are written by
 * ml/har/train_har.py from held-out UCI HAR test windows.
 */
import fixtures from './fixtures/har_fixtures.json';
import { extractFeatures, featureNames, FEATURE_COUNT } from '@/services/ml/harFeatures';
import { HAR_MODEL, HAR_MODEL_ACC_ONLY, classifyFeatures, classifyWindow } from '@/services/ml/harModel';

interface Case {
  index: number;
  label: string;
  window: number[][];
  features: number[];
  proba: number[];
  predicted: string;
  probaAccOnly: number[];
  predictedAccOnly: string;
}

const cases = (fixtures as { featureNames: string[]; cases: Case[] }).cases;

describe('HAR feature extraction parity', () => {
  it('uses identical feature names and order', () => {
    expect(featureNames()).toEqual(fixtures.featureNames);
    expect(FEATURE_COUNT).toBe(82);
    expect(HAR_MODEL.featureNames).toEqual(fixtures.featureNames);
  });

  it('has fixtures for all six classes', () => {
    expect(new Set(cases.map((c) => c.label)).size).toBe(6);
    expect(cases.length).toBeGreaterThanOrEqual(48);
  });

  it('reproduces every Python feature to within 1e-9 (relative)', () => {
    let worst = 0;
    for (const c of cases) {
      const ts = extractFeatures(c.window);
      expect(ts).toHaveLength(c.features.length);
      ts.forEach((v, i) => {
        const ref = c.features[i];
        const err = Math.abs(v - ref) / Math.max(1, Math.abs(ref));
        worst = Math.max(worst, err);
      });
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('HAR model inference parity', () => {
  it('full model: identical predicted class and probabilities', () => {
    for (const c of cases) {
      const p = classifyWindow(c.window, true);
      expect(p.modelId).toBe('har-logreg-v1');
      expect(p.label).toBe(c.predicted);
      p.probabilities.forEach((v, i) => expect(Math.abs(v - c.proba[i])).toBeLessThan(1e-7));
    }
  });

  it('accelerometer-only model: identical predicted class and probabilities', () => {
    for (const c of cases) {
      const p = classifyFeatures(extractFeatures(c.window), HAR_MODEL_ACC_ONLY);
      expect(p.label).toBe(c.predictedAccOnly);
      p.probabilities.forEach((v, i) => expect(Math.abs(v - c.probaAccOnly[i])).toBeLessThan(1e-7));
    }
  });

  it('acc-only model does not depend on gyroscope features', () => {
    expect(HAR_MODEL_ACC_ONLY.featureNames.some((n) => n.includes('gyro'))).toBe(false);
  });

  it('fixture accuracy is consistent with reported held-out accuracy', () => {
    const correct = cases.filter((c) => c.predicted === c.label).length / cases.length;
    expect(correct).toBeGreaterThan(0.75);
  });
});
