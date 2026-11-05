"""
WellTrack AI - Human Activity Recognition training / evaluation / export.

Usage (from the repository root):
    python ml/har/train_har.py

Steps
    1. Load the raw UCI HAR inertial signals (total_acc_xyz in g, body_gyro_xyz in rad/s).
    2. Extract the 82 features defined in ml/har/features.py (cached in ml/har/cache/).
    3. Hyper-parameter selection with subject-grouped 5-fold CV on the official TRAIN subjects only.
    4. Fit each model on the full train split, evaluate once on the official held-out TEST subjects.
    5. Export the deployable models (multinomial logistic regression, JSON) to models/har_model.json
       and models/har_model_acc.json (accelerometer-only fallback),
       parity fixtures to tests/fixtures/har_fixtures.json and replay sequences built from
       held-out test windows to src/assets/replay/har_replay.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             f1_score, precision_recall_fscore_support)
from sklearn.model_selection import GridSearchCV, GroupKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from features import (CHANNELS, SAMPLE_RATE_HZ, WINDOW_SIZE, WINDOW_STEP,  # noqa: E402
                      extract_batch, feature_names)

DATA = os.path.join(ROOT, "data", "human+activity+recognition+using+smartphones", "UCI HAR Dataset")
CACHE = os.path.join(HERE, "cache")
RESULTS = os.path.join(HERE, "results")
CLASSES = ["WALKING", "WALKING_UPSTAIRS", "WALKING_DOWNSTAIRS", "SITTING", "STANDING", "LAYING"]
FILE_CHANNELS = ["total_acc_x", "total_acc_y", "total_acc_z", "body_gyro_x", "body_gyro_y", "body_gyro_z"]
SEED = 42


def load_split(split: str):
    sig = [np.loadtxt(os.path.join(DATA, split, "Inertial Signals", f"{c}_{split}.txt")) for c in FILE_CHANNELS]
    X = np.stack(sig, axis=1)  # (n, 6, 128)
    y = np.loadtxt(os.path.join(DATA, split, f"y_{split}.txt"), dtype=int) - 1
    subj = np.loadtxt(os.path.join(DATA, split, f"subject_{split}.txt"), dtype=int)
    return X, y, subj


def features_cached(split: str, X: np.ndarray) -> np.ndarray:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"features_{split}.npy")
    if os.path.exists(path):
        F = np.load(path)
        if F.shape[0] == X.shape[0]:
            return F
    t = time.time()
    F = extract_batch(X)
    np.save(path, F)
    print(f"  extracted {split} features {F.shape} in {time.time() - t:.1f}s")
    return F


def candidate_models():
    return {
        "KNN": (Pipeline([("scale", StandardScaler()), ("clf", KNeighborsClassifier())]),
                {"clf__n_neighbors": [5, 9, 15, 25], "clf__weights": ["uniform", "distance"]}),
        "SVM (RBF)": (Pipeline([("scale", StandardScaler()), ("clf", SVC(kernel="rbf", random_state=SEED))]),
                      {"clf__C": [1, 10, 100], "clf__gamma": ["scale", 0.003]}),
        "Decision Tree": (DecisionTreeClassifier(random_state=SEED),
                          {"max_depth": [6, 10, 14, None], "min_samples_leaf": [1, 5, 10]}),
        "Random Forest": (RandomForestClassifier(random_state=SEED, n_jobs=-1),
                          {"n_estimators": [100], "max_depth": [12, 16, None], "min_samples_leaf": [1, 3],
                           "max_features": ["sqrt"]}),
        "Logistic Regression": (Pipeline([("scale", StandardScaler()),
                                          ("clf", LogisticRegression(max_iter=5000, random_state=SEED))]),
                                {"clf__C": [0.1, 1, 10]}),
    }


def plot_confusion(cm: np.ndarray, title: str, path: str):
    cmn = cm / cm.sum(axis=1, keepdims=True)
    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(cmn, cmap="Blues", vmin=0, vmax=1)
    short = ["Walk", "Up", "Down", "Sit", "Stand", "Lay"]
    ax.set_xticks(range(6), short)
    ax.set_yticks(range(6), short)
    for i in range(6):
        for j in range(6):
            ax.text(j, i, f"{cm[i, j]}\n{cmn[i, j]:.0%}", ha="center", va="center",
                    color="white" if cmn[i, j] > 0.5 else "black", fontsize=8)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.046)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def build_replay(X_test, y_test, s_test):
    """Reconstruct continuous 50 Hz streams from consecutive, 50 %-overlapping held-out windows."""
    sequences = []
    subjects = sorted(set(s_test.tolist()))
    for subject in [subjects[0], subjects[3]]:
        idx = np.where(s_test == subject)[0]
        for cls in range(6):
            run = [i for i in idx if y_test[i] == cls]
            # find the longest contiguous run where windows overlap exactly by WINDOW_STEP samples
            best, cur = [], [run[0]]
            for a, b in zip(run, run[1:]):
                if b == a + 1 and np.allclose(X_test[a][:, WINDOW_STEP:], X_test[b][:, :WINDOW_STEP], atol=1e-7):
                    cur.append(b)
                else:
                    best = cur if len(cur) > len(best) else best
                    cur = [b]
            best = cur if len(cur) > len(best) else best
            best = best[:12]
            stream = [X_test[best[0]]] + [X_test[i][:, WINDOW_STEP:] for i in best[1:]]
            stream = np.concatenate(stream, axis=1)
            sequences.append({
                "id": f"s{subject}-{CLASSES[cls].lower()}",
                "subject": int(subject),
                "label": CLASSES[cls],
                "windowIndices": [int(i) for i in best],
                "sampleRateHz": SAMPLE_RATE_HZ,
                "channels": CHANNELS,
                "samples": [[round(float(v), 5) for v in row] for row in stream],
            })
    return sequences


def main():
    print("Loading UCI HAR inertial signals ...")
    X_tr, y_tr, s_tr = load_split("train")
    X_te, y_te, s_te = load_split("test")
    print(f"  train {X_tr.shape} subjects={len(set(s_tr))}  test {X_te.shape} subjects={len(set(s_te))}")
    assert not set(s_tr) & set(s_te), "subject leakage between official splits"

    F_tr = features_cached("train", X_tr)
    F_te = features_cached("test", X_te)
    names = feature_names()
    assert F_tr.shape[1] == len(names)

    os.makedirs(RESULTS, exist_ok=True)
    cv = GroupKFold(n_splits=5)
    results, fitted = {}, {}
    for name, (est, grid) in candidate_models().items():
        t = time.time()
        gs = GridSearchCV(est, grid, cv=cv, scoring="f1_macro", n_jobs=-1)
        gs.fit(F_tr, y_tr, groups=s_tr)
        best = gs.best_estimator_
        pred = best.predict(F_te)
        p, r, f, sup = precision_recall_fscore_support(y_te, pred, labels=range(6), zero_division=0)
        cm = confusion_matrix(y_te, pred, labels=range(6))
        results[name] = {
            "bestParams": {k: (v if not isinstance(v, np.generic) else v.item()) for k, v in gs.best_params_.items()},
            "cvMacroF1": round(float(gs.best_score_), 4),
            "testAccuracy": round(float(accuracy_score(y_te, pred)), 4),
            "testMacroF1": round(float(f1_score(y_te, pred, average="macro")), 4),
            "testMacroPrecision": round(float(np.mean(p)), 4),
            "testMacroRecall": round(float(np.mean(r)), 4),
            "perClass": {CLASSES[i]: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                                      "f1": round(float(f[i]), 4), "support": int(sup[i])} for i in range(6)},
            "confusionMatrix": cm.tolist(),
            "trainSeconds": round(time.time() - t, 1),
        }
        fitted[name] = best
        plot_confusion(cm, f"{name} - held-out test subjects", os.path.join(RESULTS, f"cm_{name.split()[0].lower()}.png"))
        print(f"  {name:20s} cvF1={gs.best_score_:.4f} testAcc={results[name]['testAccuracy']:.4f} "
              f"testF1={results[name]['testMacroF1']:.4f} params={gs.best_params_}")
        print(classification_report(y_te, pred, target_names=CLASSES, digits=4))

    # Deployable models. Multinomial logistic regression beat the random forest on the held-out
    # subjects and is ~100x smaller, so it is deployed (pure dot products in TypeScript).
    # The RBF SVM scored highest but needs thousands of support vectors and has no native
    # probability output; the gap is documented in docs/ML_REPORT.md.
    lr_C = results["Logistic Regression"]["bestParams"]["clf__C"]
    acc_idx = [i for i, n in enumerate(names) if "gyro" not in n]
    variants = {
        "full": ("har-logreg-v1", list(range(len(names))), "accelerometer + gyroscope"),
        "acc_only": ("har-logreg-acc-v1", acc_idx, "accelerometer only (fallback when no gyroscope)"),
    }
    exported = {}
    for key, (model_id, cols, sensors) in variants.items():
        scaler = StandardScaler().fit(F_tr[:, cols])
        clf = LogisticRegression(C=lr_C, max_iter=5000, random_state=SEED)
        clf.fit(scaler.transform(F_tr[:, cols]), y_tr)
        Z_te = scaler.transform(F_te[:, cols])
        proba = clf.predict_proba(Z_te)
        dp = proba.argmax(axis=1)
        p, r, f, sup = precision_recall_fscore_support(y_te, dp, labels=range(6), zero_division=0)
        cm = confusion_matrix(y_te, dp, labels=range(6))
        conf = proba.max(axis=1)
        correct = (dp == y_te).astype(float)
        bins = np.linspace(0, 1, 11)
        ece, reliability = 0.0, []
        for lo, hi in zip(bins[:-1], bins[1:]):
            m = (conf > lo) & (conf <= hi)
            if m.any():
                ece += m.mean() * abs(correct[m].mean() - conf[m].mean())
                reliability.append({"bin": [round(float(lo), 1), round(float(hi), 1)], "count": int(m.sum()),
                                    "meanConfidence": round(float(conf[m].mean()), 4),
                                    "accuracy": round(float(correct[m].mean()), 4)})
        metrics = {
            "accuracy": round(float(accuracy_score(y_te, dp)), 4),
            "macroF1": round(float(f1_score(y_te, dp, average="macro")), 4),
            "macroPrecision": round(float(np.mean(p)), 4),
            "macroRecall": round(float(np.mean(r)), 4),
            "expectedCalibrationError": round(float(ece), 4),
            "reliability": reliability,
            "perClass": {CLASSES[i]: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                                      "f1": round(float(f[i]), 4), "support": int(sup[i])} for i in range(6)},
            "confusionMatrix": cm.tolist(),
        }
        plot_confusion(cm, f"Deployed {model_id} - held-out test", os.path.join(RESULTS, f"cm_deployed_{key}.png"))
        print(f"Deployed {model_id}: acc={metrics['accuracy']} macroF1={metrics['macroF1']} "
              f"ECE={metrics['expectedCalibrationError']}")

        # verify the exported math (standardise -> softmax(Wx+b)) reproduces sklearn
        logits = Z_te @ clf.coef_.T + clf.intercept_
        logits -= logits.max(axis=1, keepdims=True)
        mine = np.exp(logits) / np.exp(logits).sum(axis=1, keepdims=True)
        assert np.allclose(mine, proba, atol=1e-9)

        coef_abs = np.abs(clf.coef_).mean(axis=0)
        top = sorted(zip([names[c] for c in cols], coef_abs), key=lambda t: -t[1])[:15]
        exported[key] = {
            "modelId": model_id,
            "task": "human_activity_recognition",
            "type": "logistic_regression",
            "sensors": sensors,
            "classes": CLASSES,
            "featureNames": [names[c] for c in cols],
            "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
            "coef": clf.coef_.tolist(),
            "intercept": clf.intercept_.tolist(),
            "preprocessing": {
                "sampleRateHz": SAMPLE_RATE_HZ, "windowSize": WINDOW_SIZE, "windowStep": WINDOW_STEP,
                "channels": CHANNELS, "accelerometerUnits": "g (gravity included, Android axis/sign convention)",
                "gyroscopeUnits": "rad/s", "filter": "3-point median per channel",
            },
            "hyperparameters": {"C": lr_C, "penalty": "l2", "multiClass": "multinomial (softmax)"},
            "metrics": {"test": metrics,
                        "comparison": {k: {"accuracy": v["testAccuracy"], "macroF1": v["testMacroF1"],
                                           "cvMacroF1": v["cvMacroF1"]} for k, v in results.items()}},
            "featureImportanceTop": [{"feature": n, "meanAbsStdCoef": round(float(v), 4)} for n, v in top],
            "dataset": {
                "name": "UCI Human Activity Recognition Using Smartphones",
                "source": "https://archive.ics.uci.edu/dataset/240/human+activity+recognition+using+smartphones",
                "license": "CC BY 4.0",
                "trainWindows": int(len(y_tr)), "testWindows": int(len(y_te)),
                "trainSubjects": sorted(int(s) for s in set(s_tr)), "testSubjects": sorted(int(s) for s in set(s_te)),
                "split": "official subject-separated split (21 train / 9 test subjects)",
            },
            "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sklearnVersion": sklearn.__version__,
            "limitations": [
                "Trained on a waist-mounted Samsung Galaxy S II (landscape, on the belt); other placements and orientations shift the input distribution.",
                "Held-out accuracy is measured on dataset subjects, not on live phones; live accuracy is not guaranteed.",
                "Softmax probabilities were checked for calibration on held-out subjects only (see ECE); they are not calibrated for live phones.",
                "Only six activities are recognised; running, cycling, etc. will be mapped to the closest known class.",
            ],
        }

    os.makedirs(os.path.join(ROOT, "models"), exist_ok=True)
    for key, fname in [("full", "har_model.json"), ("acc_only", "har_model_acc.json")]:
        path = os.path.join(ROOT, "models", fname)
        with open(path, "w") as fh:
            json.dump(exported[key], fh, separators=(",", ":"))
        print(f"Exported models/{fname} ({os.path.getsize(path) / 1024:.0f} KB)")
    deploy_metrics = exported["full"]["metrics"]["test"]

    def lr_proba(model, F):
        Z = (F - np.array(model["scaler"]["mean"])) / np.array(model["scaler"]["scale"])
        L = Z @ np.array(model["coef"]).T + np.array(model["intercept"])
        L -= L.max(axis=1, keepdims=True)
        return np.exp(L) / np.exp(L).sum(axis=1, keepdims=True)

    # Parity fixtures: rounded raw windows -> python features -> predictions
    rng = np.random.default_rng(SEED)
    pick = []
    for cls in range(6):
        pick += rng.choice(np.where(y_te == cls)[0], size=8, replace=False).tolist()
    windows = np.round(X_te[pick], 6)
    F_fix = extract_batch(windows)
    proba = lr_proba(exported["full"], F_fix)
    proba_acc = lr_proba(exported["acc_only"], F_fix[:, acc_idx])
    fixtures = {
        "featureNames": names,
        "cases": [{"index": int(i), "label": CLASSES[y_te[i]], "window": w.tolist(),
                   "features": f.tolist(), "proba": pr.tolist(), "predicted": CLASSES[int(pr.argmax())],
                   "probaAccOnly": pa.tolist(), "predictedAccOnly": CLASSES[int(pa.argmax())]}
                  for i, w, f, pr, pa in zip(pick, windows, F_fix, proba, proba_acc)],
    }
    os.makedirs(os.path.join(ROOT, "tests", "fixtures"), exist_ok=True)
    with open(os.path.join(ROOT, "tests", "fixtures", "har_fixtures.json"), "w") as fh:
        json.dump(fixtures, fh)

    replay = build_replay(X_te, y_te, s_te)
    os.makedirs(os.path.join(ROOT, "src", "assets", "replay"), exist_ok=True)
    with open(os.path.join(ROOT, "src", "assets", "replay", "har_replay.json"), "w") as fh:
        json.dump({"source": "UCI HAR held-out TEST subjects (never used for training)",
                   "license": "CC BY 4.0", "sequences": replay}, fh, separators=(",", ":"))
    print("Replay sequences:", [(s["id"], len(s["samples"][0])) for s in replay])

    with open(os.path.join(RESULTS, "metrics.json"), "w") as fh:
        json.dump({"models": results, "deployed": deploy_metrics, "featureCount": len(names),
                   "deployedAccOnly": exported["acc_only"]["metrics"]["test"]}, fh, indent=2)
    print("Done.")


if __name__ == "__main__":
    main()
