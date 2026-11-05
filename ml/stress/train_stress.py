"""WellTrack AI - stress-risk classification experiment.

Dataset: Kaggle "student lifestyle dataset" (steve1215rogg/student-lifestyle-dataset).
See docs/STRESS_DATASET.md for provenance, licence and the label-provenance analysis.

Run from the repository root:
    python -I ml/stress/train_stress.py

Outputs:
    ml/stress/results/metrics.json      full experiment results
    ml/stress/results/cm_*.png          confusion matrices (test set)
    ml/stress/fixtures.json             20 test rows + sklearn predictions for TS parity tests
    models/stress_model.json            deployable model (schema agreed with app lead)

Everything is deterministic (random_state=42).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import sklearn  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split  # noqa: E402
from sklearn.neighbors import KNeighborsClassifier  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from sklearn.svm import SVC  # noqa: E402
from sklearn.tree import DecisionTreeClassifier, export_text  # noqa: E402

SEED = 42
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_CSV = os.path.join(ROOT, "data", "stress", "raw", "extracted", "student_lifestyle_dataset.csv")
RESULTS_DIR = os.path.join(ROOT, "ml", "stress", "results")
FIXTURES_PATH = os.path.join(ROOT, "ml", "stress", "fixtures.json")
MODEL_PATH = os.path.join(ROOT, "models", "stress_model.json")

CLASSES = ["Low", "Moderate", "High"]  # integer label i <-> CLASSES[i]; also probability order
TARGET = "Stress_Level"

STUDY = "Study_Hours_Per_Day"
EXTRA = "Extracurricular_Hours_Per_Day"
SLEEP = "Sleep_Hours_Per_Day"
SOCIAL = "Social_Hours_Per_Day"
PHYS = "Physical_Activity_Hours_Per_Day"
GPA = "GPA"

# Feature sets compared in the experiment.
FEATURE_SETS = {
    # everything in the dataset (GPA and extracurricular hours are NOT collected by the app)
    "all_with_gpa": [STUDY, EXTRA, SLEEP, SOCIAL, PHYS, GPA],
    "all_without_gpa": [STUDY, EXTRA, SLEEP, SOCIAL, PHYS],
    # every dataset column that maps onto an app check-in field with identical units
    "app_mappable": [STUDY, SLEEP, SOCIAL, PHYS],
    # the two app-mappable columns the dataset author says the label was derived from
    "app_study_sleep": [STUDY, SLEEP],
}
DEPLOYABLE_FEATURE_SETS = ["app_mappable", "app_study_sleep"]  # only app-mappable inputs may ship

UNITS = {STUDY: "hours/day", SLEEP: "hours/day", SOCIAL: "hours/day", PHYS: "hours/day"}
APP_MAPPING = {
    STUDY: "studyHours (hours/day), no transform",
    SLEEP: "sleepHours (hours/day), no transform",
    SOCIAL: "socialActivityHours (hours/day), no transform",
    PHYS: "physicalActivityMinutes / 60 (minutes/day -> hours/day)",
}

# Hyper-parameter grids, tuned on the validation split only.
GRIDS = {
    "logistic_regression": [{"C": c} for c in (0.01, 0.1, 1.0, 10.0, 100.0)],
    "knn": [{"n_neighbors": k, "weights": w} for k in (3, 5, 9, 15, 25) for w in ("uniform", "distance")],
    "svm": [{"C": c, "gamma": "scale"} for c in (0.1, 1.0, 10.0, 100.0)],
    "decision_tree": [{"max_depth": d, "min_samples_leaf": m} for d in (2, 3, 4, 6, None) for m in (1, 5)],
    "random_forest": [{"n_estimators": n, "max_depth": d} for n in (25, 50) for d in (3, 5, 8, None)],
}
# Ordering used for "prefer the simplest deployable model" (earlier = simpler / easier to audit).
DEPLOYABLE_MODELS = ["decision_tree", "logistic_regression", "random_forest"]
TOLERANCE = 0.01  # macro-F1 tolerance when preferring a simpler model


def make_model(name: str, params: dict):
    """Return an unfitted estimator. Scale-sensitive models get a StandardScaler (fit on train only)."""
    if name == "logistic_regression":
        # lbfgs + multi-class target -> multinomial (softmax) model in sklearn 1.6
        clf = LogisticRegression(max_iter=5000, class_weight="balanced", random_state=SEED, **params)
        return Pipeline([("scaler", StandardScaler()), ("clf", clf)])
    if name == "knn":
        # KNN has no class_weight option; imbalance is reported, not corrected, for KNN
        return Pipeline([("scaler", StandardScaler()), ("clf", KNeighborsClassifier(**params))])
    if name == "svm":
        clf = SVC(kernel="rbf", class_weight="balanced", random_state=SEED, **params)
        return Pipeline([("scaler", StandardScaler()), ("clf", clf)])
    if name == "decision_tree":
        return DecisionTreeClassifier(class_weight="balanced", random_state=SEED, **params)
    if name == "random_forest":
        return RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=1, **params)
    raise ValueError(name)


def evaluate(y_true, y_pred) -> dict:
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=[0, 1, 2], zero_division=0)
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 6),
        "macroF1": round(float(f1_score(y_true, y_pred, average="macro")), 6),
        "perClass": {
            c: {"precision": round(float(p[i]), 6), "recall": round(float(r[i]), 6),
                "f1": round(float(f[i]), 6), "support": int(s[i])}
            for i, c in enumerate(CLASSES)
        },
        "confusionMatrix": confusion_matrix(y_true, y_pred, labels=[0, 1, 2]).tolist(),
    }


def plot_cm(cm, title: str, path: str) -> None:
    cm = np.asarray(cm)
    fig, ax = plt.subplots(figsize=(4.6, 4.0), dpi=150)
    ax.imshow(cm, cmap="Blues", vmin=0, vmax=max(cm.max(), 1))
    for i in range(3):
        for j in range(3):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=11,
                    color="white" if cm[i, j] > cm.max() * 0.55 else "#1a1a1a")
    ax.set_xticks(range(3), CLASSES)
    ax.set_yticks(range(3), CLASSES)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title(title, fontsize=9)
    for s in ax.spines.values():
        s.set_visible(False)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def label_provenance(df: pd.DataFrame, y: np.ndarray) -> dict:
    """Probe whether the label is a deterministic function of the features."""
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    probes = {}
    for set_name, feats in [("study_sleep", [STUDY, SLEEP]), ("study_only", [STUDY]), ("sleep_only", [SLEEP]),
                            ("all_with_gpa", FEATURE_SETS["all_with_gpa"])]:
        for depth in (1, 2, 3):
            acc = cross_val_score(DecisionTreeClassifier(max_depth=depth, random_state=SEED), df[feats], y, cv=cv)
            probes[f"{set_name}_depth{depth}_cv5_accuracy"] = round(float(acc.mean()), 4)
    tree = DecisionTreeClassifier(max_depth=3, random_state=SEED).fit(df[[STUDY, SLEEP]], y)
    # Closed-form rule read off that tree (data has 0.1 h resolution)
    rule = np.where((df[STUDY] > 8) | (df[SLEEP] < 6), 2, np.where(df[STUDY] < 6, 0, 1))
    activity = [STUDY, EXTRA, SLEEP, SOCIAL, PHYS]
    total = df[activity].sum(axis=1)
    return {
        "depth3TreeStudySleep": export_text(tree, feature_names=[STUDY, SLEEP], class_names=CLASSES),
        "shallowTreeProbes": probes,
        "ruleText": "High if Study>8.0 or Sleep<6.0; else Low if Study<6.0; else Moderate",
        "ruleAgreementAllRows": round(float((rule == y).mean()), 6),
        "ruleMismatches": int((rule != y).sum()),
        "fiveActivityColumnsSumTo24": {
            "min": round(float(total.min()), 6), "max": round(float(total.max()), 6),
            "physicalActivityEquals24MinusOthers": bool(np.allclose(df[PHYS], 24 - df[[STUDY, EXTRA, SLEEP, SOCIAL]].sum(axis=1))),
        },
    }


def export_tree(est) -> dict:
    t = est.tree_
    value = t.value[:, 0, :].astype(float)
    value = value / value.sum(axis=1, keepdims=True)  # per-node class probability distribution
    return {
        "feature": t.feature.astype(int).tolist(),       # -2 at leaves
        "threshold": [float(v) for v in t.threshold],  # x[feature] <= threshold -> left (float32 values, exact)
        "left": t.children_left.astype(int).tolist(),    # -1 at leaves
        "right": t.children_right.astype(int).tolist(),  # -1 at leaves
        "value": [[float(v) for v in row] for row in value],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=DEFAULT_CSV)
    args = ap.parse_args()
    os.makedirs(RESULTS_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

    df = pd.read_csv(args.csv)
    assert set(df[TARGET].unique()) == set(CLASSES), df[TARGET].unique()
    y = df[TARGET].map({c: i for i, c in enumerate(CLASSES)}).to_numpy()

    profile = {
        "rows": int(len(df)), "columns": list(df.columns),
        "missingValues": {c: int(v) for c, v in df.isna().sum().items()},
        "duplicateRowsExcludingId": int(df.drop(columns=["Student_ID"]).duplicated().sum()),
        "classDistribution": {c: int((y == i).sum()) for i, c in enumerate(CLASSES)},
        "featureStats": {c: {"min": float(df[c].min()), "max": float(df[c].max()),
                             "mean": round(float(df[c].mean()), 4), "std": round(float(df[c].std()), 4)}
                         for c in FEATURE_SETS["all_with_gpa"]},
    }
    provenance = label_provenance(df, y)

    # 70 / 15 / 15 stratified split
    idx = np.arange(len(df))
    idx_train, idx_tmp = train_test_split(idx, test_size=0.30, stratify=y, random_state=SEED)
    idx_val, idx_test = train_test_split(idx_tmp, test_size=0.50, stratify=y[idx_tmp], random_state=SEED)
    splits = {"train": len(idx_train), "validation": len(idx_val), "test": len(idx_test)}

    results: dict = {}
    fitted: dict = {}
    for set_name, feats in FEATURE_SETS.items():
        Xtr, Xva, Xte = (df.iloc[i][feats].to_numpy(dtype=float) for i in (idx_train, idx_val, idx_test))
        ytr, yva, yte = y[idx_train], y[idx_val], y[idx_test]
        results[set_name] = {}
        for model_name, grid in GRIDS.items():
            best = None
            for params in grid:
                m = make_model(model_name, params).fit(Xtr, ytr)
                f = f1_score(yva, m.predict(Xva), average="macro")
                if best is None or f > best[0] + 1e-12:  # ties keep the earlier (simpler) setting
                    best = (f, params, m)
            _, params, m = best
            results[set_name][model_name] = {
                "bestParams": params,
                "validation": evaluate(yva, m.predict(Xva)),
                "test": evaluate(yte, m.predict(Xte)),  # test touched once per tuned model, for reporting
            }
            fitted[(set_name, model_name)] = m
            plot_cm(results[set_name][model_name]["test"]["confusionMatrix"],
                    f"{model_name} | {set_name} | test", os.path.join(RESULTS_DIR, f"cm_{set_name}_{model_name}.png"))

    # Reference row: the closed-form rule (not a learned model) on the same test split
    rule_pred = np.where((df[STUDY] > 8) | (df[SLEEP] < 6), 2, np.where(df[STUDY] < 6, 0, 1))
    rule_test = evaluate(y[idx_test], rule_pred[idx_test])

    # ---- Deployment choice: validation macro-F1 only; prefer fewer features, then simpler model ----
    candidates = [(s, m) for s in DEPLOYABLE_FEATURE_SETS for m in DEPLOYABLE_MODELS]
    best_val = max(results[s][m]["validation"]["macroF1"] for s, m in candidates)
    order = sorted(candidates, key=lambda sm: (len(FEATURE_SETS[sm[0]]), DEPLOYABLE_MODELS.index(sm[1])))
    chosen_set, chosen_model = next(sm for sm in order if results[sm[0]][sm[1]]["validation"]["macroF1"] >= best_val - TOLERANCE)
    feats = FEATURE_SETS[chosen_set]
    est = fitted[(chosen_set, chosen_model)]
    chosen = results[chosen_set][chosen_model]
    plot_cm(chosen["test"]["confusionMatrix"], f"deployed {chosen_model} | {chosen_set} | test",
            os.path.join(RESULTS_DIR, "cm_deployed.png"))

    Xtrain_dep = df.iloc[idx_train][feats]
    model_json: dict = {
        "modelId": "stress-v1",
        "task": "stress_risk",
        "type": chosen_model,
        "classes": CLASSES,
        "featureNames": feats,
        "featureUnits": {f: UNITS[f] for f in feats},
        "appInputMapping": {f: APP_MAPPING[f] for f in feats},
        "featureRanges": {f: [float(Xtrain_dep[f].min()), float(Xtrain_dep[f].max())] for f in feats},
        "scaler": None,
    }
    if chosen_model == "logistic_regression":
        sc, clf = est.named_steps["scaler"], est.named_steps["clf"]
        assert list(clf.classes_) == [0, 1, 2]
        model_json["scaler"] = {"mean": sc.mean_.tolist(), "scale": sc.scale_.tolist()}
        model_json["coef"] = clf.coef_.tolist()
        model_json["intercept"] = clf.intercept_.tolist()
    elif chosen_model == "decision_tree":
        assert list(est.classes_) == [0, 1, 2]
        model_json["trees"] = [export_tree(est)]
    else:
        assert list(est.classes_) == [0, 1, 2]
        model_json["trees"] = [export_tree(t) for t in est.estimators_]

    model_json["metrics"] = {
        "test": chosen["test"],
        "validation": chosen["validation"],
        "comparison": {m: {"accuracy": results[chosen_set][m]["test"]["accuracy"],
                           "macroF1": results[chosen_set][m]["test"]["macroF1"]} for m in GRIDS},
    }
    model_json["dataset"] = {
        "name": "student lifestyle dataset (Kaggle, Sumit Kumar / steve1215rogg), version 1",
        "source": "https://www.kaggle.com/datasets/steve1215rogg/student-lifestyle-dataset "
                  "(downloaded via https://www.kaggle.com/api/v1/datasets/download/steve1215rogg/student-lifestyle-dataset)",
        "license": "Apache 2.0 (as declared on the Kaggle dataset page)",
        "samples": int(len(df)),
        "labelProvenance": "Rule-derived, not measured. The Kaggle description states the stress level is 'derived based on "
                           "study and sleep hours'; the rule " + provenance["ruleText"] + " reproduces "
                           f"{provenance['ruleMismatches'] == 0 and 'all' or 'not all'} {len(df)} labels. "
                           "Feature rows also look synthetic (the five activity columns sum to exactly 24 h in every row).",
    }
    model_json["trainedAt"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    model_json["sklearnVersion"] = sklearn.__version__
    model_json["limitations"] = [
        "Labels are rule-derived from study and sleep hours (High if study>8 h or sleep<6 h; Low if study<6 h; else Moderate). "
        "The model reproduces that rule; it has not learned stress from any measured or self-reported stress outcome.",
        "100% test accuracy reflects the deterministic label, not real-world predictive validity. The model has not been validated against any clinical or psychometric stress measure.",
        "The dataset appears synthetic: the five daily-activity columns sum to exactly 24.0 h in every row and Physical_Activity_Hours_Per_Day is exactly 24 minus the other four.",
        "Training ranges: study 5-10 h/day, sleep 5-10 h/day. Inputs outside these ranges are extrapolation (e.g. study < 5 h with sleep >= 6 h is classified Low; sleep < 6 h is always High).",
        "Social activity, physical activity, academic pressure, screen time, self-reported stress and mood have no effect on this model's output.",
        "Population claimed by the author: students in India / South Asia via Google Forms (unverified).",
        "Not a medical or diagnostic tool; output is an indicative 'stress-risk' category only.",
    ]

    # ---- fixtures for TypeScript parity: 20 test rows (7 Low, 7 Moderate, 6 High), raw values ----
    rng = np.random.default_rng(SEED)
    test_df = df.iloc[idx_test]
    pick = []
    for cls_i, n in ((0, 7), (1, 7), (2, 6)):
        pool = test_df.index[y[test_df.index] == cls_i].to_numpy()
        pick.extend(sorted(rng.choice(pool, size=n, replace=False).tolist()))
    Xf = df.loc[pick, feats].to_numpy(dtype=float)
    proba = est.predict_proba(Xf)
    pred = est.predict(Xf)
    fixtures = {
        "modelId": "stress-v1", "classes": CLASSES, "featureNames": feats,
        "note": "Raw (unscaled) feature values in featureNames order; proba in classes order; sklearn predict_proba output.",
        "rows": [{"rowIndex": int(r), "studentId": int(df.loc[r, "Student_ID"]),
                  "features": [float(v) for v in Xf[k]], "trueLabel": CLASSES[int(y[r])],
                  "predictedClass": CLASSES[int(pred[k])], "proba": [float(p) for p in proba[k]]}
                 for k, r in enumerate(pick)],
    }

    metrics = {
        "seed": SEED, "split": splits, "splitMethod": "stratified 70/15/15 via two train_test_split calls",
        "selectionMetric": "validation macro-F1", "classWeighting": "balanced for LR, SVM, DT, RF; none for KNN",
        "datasetProfile": profile, "labelProvenance": provenance,
        "results": results, "ruleBaselineTest": rule_test,
        "deployed": {"featureSet": chosen_set, "model": chosen_model, "params": chosen["bestParams"],
                     "rule": f"among deployable sets {DEPLOYABLE_FEATURE_SETS} x models {DEPLOYABLE_MODELS}, "
                             f"first (fewest features, then simplest model) with validation macro-F1 >= best - {TOLERANCE}"},
        "sklearnVersion": sklearn.__version__,
    }
    with open(os.path.join(RESULTS_DIR, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(metrics, fh, indent=2)
    with open(FIXTURES_PATH, "w", encoding="utf-8") as fh:
        json.dump(fixtures, fh, indent=2)
    with open(MODEL_PATH, "w", encoding="utf-8") as fh:
        json.dump(model_json, fh, indent=2)

    # ---- console summary ----
    print("profile:", json.dumps(profile["classDistribution"]), "split:", splits)
    print("rule agreement:", provenance["ruleAgreementAllRows"], "probes:", provenance["shallowTreeProbes"])
    print(f"{'feature set':18s} {'model':20s} {'val acc':>8s} {'val F1':>8s} {'test acc':>8s} {'test F1':>8s}  params")
    for s, by_model in results.items():
        for m, r in by_model.items():
            print(f"{s:18s} {m:20s} {r['validation']['accuracy']:8.4f} {r['validation']['macroF1']:8.4f} "
                  f"{r['test']['accuracy']:8.4f} {r['test']['macroF1']:8.4f}  {r['bestParams']}")
    print("rule baseline test:", rule_test["accuracy"], rule_test["macroF1"])
    print("DEPLOYED:", chosen_set, chosen_model, chosen["bestParams"], "size bytes:", os.path.getsize(MODEL_PATH))
    if chosen_model in ("decision_tree", "random_forest"):
        print(export_text(est if chosen_model == "decision_tree" else est.estimators_[0], feature_names=feats))


if __name__ == "__main__":
    main()
