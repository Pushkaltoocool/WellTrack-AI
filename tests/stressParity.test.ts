import { describe, expect, it } from '@jest/globals';
import fixtures from '../ml/stress/fixtures.json';
import { predictScores, type ExportedModelBase } from '@/services/ml/inference';
import { STRESS_MODEL } from '@/services/ml/stressModel';

interface Row {
  features: number[];
  predictedClass: string;
  proba: number[];
}

describe('stress model parity (Python fixtures)', () => {
  const model = STRESS_MODEL as unknown as ExportedModelBase;

  it('loads the exported model with the expected inputs', () => {
    expect(model.featureNames).toEqual(['Study_Hours_Per_Day', 'Sleep_Hours_Per_Day']);
    expect(model.classes).toEqual(['Low', 'Moderate', 'High']);
  });

  it('reproduces sklearn predictions and predict_proba for every fixture row', () => {
    const rows = (fixtures as { rows: Row[] }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows) {
      const p = predictScores(model, r.features);
      expect(p.label).toBe(r.predictedClass);
      p.scores.forEach((v, i) => expect(Math.abs(v - r.proba[i])).toBeLessThan(1e-9));
    }
  });

  it('applies the float32 threshold comparison like sklearn at the rule boundary', () => {
    // labels in the dataset are rule-derived: High if study > 8 or sleep < 6
    expect(predictScores(model, [8.0, 7]).label).toBe('Moderate');
    expect(predictScores(model, [8.1, 7]).label).toBe('High');
    expect(predictScores(model, [7, 5.9]).label).toBe('High');
    expect(predictScores(model, [5.5, 7]).label).toBe('Low');
  });
});
