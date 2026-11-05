/**
 * Pure-TypeScript inference for classical scikit-learn models exported to JSON by the
 * Python pipelines in ml/. No native modules — runs inside Expo Go.
 */

export interface ExportedTree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  /** Per-node class distribution (normalised); only leaves are read. */
  value: number[][];
}

export interface ExportedModelBase {
  modelId: string;
  task: string;
  type: 'random_forest' | 'decision_tree' | 'logistic_regression';
  classes: string[];
  featureNames: string[];
  scaler: { mean: number[]; scale: number[] } | null;
  trees?: ExportedTree[];
  coef?: number[][];
  intercept?: number[];
  trainedAt: string;
  sklearnVersion: string;
  limitations?: string[];
  dataset: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export interface ClassScores {
  /** Class with the highest score. */
  label: string;
  index: number;
  /**
   * Per-class scores. For forests this is the mean leaf class distribution ("vote share"),
   * for logistic regression the softmax output. Neither is guaranteed to be calibrated.
   */
  scores: number[];
}

function applyScaler(model: ExportedModelBase, x: readonly number[]): number[] {
  if (!model.scaler) return x.slice();
  const { mean, scale } = model.scaler;
  return x.map((v, i) => (v - mean[i]) / (scale[i] === 0 ? 1 : scale[i]));
}

function treeLeaf(tree: ExportedTree, x: readonly number[]): number[] {
  let node = 0;
  // sklearn convention: children_left == -1 marks a leaf; test is x[f] <= threshold -> left.
  // sklearn casts inputs to float32 before comparing, so do the same for exact parity.
  while (tree.left[node] !== -1) {
    node = Math.fround(x[tree.feature[node]]) <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

export interface PathStep {
  feature: string;
  threshold: number;
  value: number;
  wentLeft: boolean; // true => value <= threshold
}

/** Decision path of a single-tree model for one input (used to explain which inputs decided the class). */
export function explainTreePath(model: ExportedModelBase, features: readonly number[]): PathStep[] {
  const tree = model.trees?.[0];
  if (!tree || model.type !== 'decision_tree') return [];
  const x = applyScaler(model, features);
  const steps: PathStep[] = [];
  let node = 0;
  while (tree.left[node] !== -1) {
    const f = tree.feature[node];
    const wentLeft = Math.fround(x[f]) <= tree.threshold[node];
    steps.push({ feature: model.featureNames[f], threshold: tree.threshold[node], value: features[f], wentLeft });
    node = wentLeft ? tree.left[node] : tree.right[node];
  }
  return steps;
}

function argmax(v: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

export function predictScores(model: ExportedModelBase, features: readonly number[]): ClassScores {
  if (features.length !== model.featureNames.length) {
    throw new Error(`${model.modelId}: expected ${model.featureNames.length} features, got ${features.length}`);
  }
  for (const v of features) {
    if (!Number.isFinite(v)) throw new Error(`${model.modelId}: non-finite feature value`);
  }
  const x = applyScaler(model, features);
  const k = model.classes.length;
  let scores: number[];

  if (model.type === 'random_forest' || model.type === 'decision_tree') {
    const trees = model.trees ?? [];
    if (trees.length === 0) throw new Error(`${model.modelId}: no trees`);
    scores = new Array<number>(k).fill(0);
    for (const t of trees) {
      const leaf = treeLeaf(t, x);
      for (let c = 0; c < k; c++) scores[c] += leaf[c];
    }
    scores = scores.map((s) => s / trees.length);
  } else if (model.type === 'logistic_regression') {
    const coef = model.coef ?? [];
    const intercept = model.intercept ?? [];
    let logits: number[];
    if (coef.length === 1 && k === 2) {
      // binary sklearn export: single row of coefficients for the positive class
      const z = intercept[0] + coef[0].reduce((acc, w, i) => acc + w * x[i], 0);
      logits = [0, z];
    } else {
      logits = coef.map((row, c) => intercept[c] + row.reduce((acc, w, i) => acc + w * x[i], 0));
    }
    const m = Math.max(...logits);
    const exps = logits.map((z) => Math.exp(z - m));
    const total = exps.reduce((a, b) => a + b, 0);
    scores = exps.map((e) => e / total);
  } else {
    throw new Error(`unsupported model type ${(model as { type: string }).type}`);
  }

  const index = argmax(scores);
  return { label: model.classes[index], index, scores };
}
