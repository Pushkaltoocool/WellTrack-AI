"""
WellTrack AI - Human Activity Recognition training / evaluation / export.

Usage (from the repository root):
    python -I ml/har/train_har.py                                  # UCI + data/collected (if present)
    python -I ml/har/train_har.py --collected data/collected --collected-only
    python -I ml/har/train_har.py --lr-only --out-dir C:/tmp/har   # skip the 4 comparison models

Label set (app): WALKING, RUNNING, WALKING_UPSTAIRS, WALKING_DOWNSTAIRS, SITTING, STANDING, LAYING.
UCI HAR provides six of them (no RUNNING). A class is exported only if it has at least --min-subjects
distinct subjects and --min-windows windows in the data used, so RUNNING stays out until enough
recordings arrive. The app maps predictions through `model.classes`, so a subset is fine.

Steps
    1. Load the raw UCI HAR inertial signals (total_acc_xyz in g, body_gyro_xyz in rad/s) unless
       --collected-only, and any app recordings (ml/har/collected.py; 128-sample windows, 64 step,
       within segments only, exactly like the app).
    2. Extract the 82 features defined in ml/har/features.py (cached in ml/har/cache/).
    3. Split by subject. UCI: official 21 train / 9 test subjects. Collected: a stable hash of the
       subject id puts ~--collected-test-frac of subjects in the held-out set.
    4. Hyper-parameter selection with subject-grouped 5-fold CV on the training subjects only.
    5. Fit on the training subjects, evaluate once on the held-out subjects (optionally refit on
       everyone with --refit-all before export).
    6. Write to --out-dir (default ml/har/build/): har_model.json, har_model_acc.json (accelerometer-only
       fallback), har_fixtures.json (parity fixtures for tests/harParity.test.ts), har_replay.json
       (UCI held-out clips), metrics.json, class_counts.csv and confusion-matrix PNGs.
       Shipping = copying those files into the app (see docs/ML_REPORT.md section 3).

With no collected data this reproduces the UCI-only 6-class model of v1 (same data, folds and C).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
import time
import warnings
from collections import Counter
from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import sklearn
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.exceptions import UndefinedMetricWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             precision_recall_fscore_support)
from sklearn.model_selection import GridSearchCV, GroupKFold, cross_val_predict
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from collected import CLASSES as ALL_CLASSES, SHORT, load_collected  # noqa: E402
from features import (CHANNELS, SAMPLE_RATE_HZ, WINDOW_SIZE, WINDOW_STEP,  # noqa: E402
                      extract_batch, feature_names)

DATA = os.path.join(ROOT, "data", "human+activity+recognition+using+smartphones", "UCI HAR Dataset")
CACHE = os.path.join(HERE, "cache")
DEFAULT_OUT = os.path.join(HERE, "build")
DEFAULT_COLLECTED = os.path.join(ROOT, "data", "collected")
# Label order of y_{train,test}.txt (1-based in the files).
UCI_CLASSES = ["WALKING", "WALKING_UPSTAIRS", "WALKING_DOWNSTAIRS", "SITTING", "STANDING", "LAYING"]
FILE_CHANNELS = ["total_acc_x", "total_acc_y", "total_acc_z", "body_gyro_x", "body_gyro_y", "body_gyro_z"]
COLLECTED_GROUP_BASE = 1000  # collected subjects get integer groups >= 1000; UCI keeps its ids 1..30
SEED = 42

warnings.filterwarnings("ignore", category=UndefinedMetricWarning)


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


def candidate_models(class_weight):
    return {
        "KNN": (Pipeline([("scale", StandardScaler()), ("clf", KNeighborsClassifier())]),
                {"clf__n_neighbors": [5, 9, 15, 25], "clf__weights": ["uniform", "distance"]}),
        "SVM (RBF)": (Pipeline([("scale", StandardScaler()),
                                ("clf", SVC(kernel="rbf", random_state=SEED, class_weight=class_weight))]),
                      {"clf__C": [1, 10, 100], "clf__gamma": ["scale", 0.003]}),
        "Decision Tree": (DecisionTreeClassifier(random_state=SEED, class_weight=class_weight),
                          {"max_depth": [6, 10, 14, None], "min_samples_leaf": [1, 5, 10]}),
        "Random Forest": (RandomForestClassifier(random_state=SEED, n_jobs=-1, class_weight=class_weight),
                          {"n_estimators": [100], "max_depth": [12, 16, None], "min_samples_leaf": [1, 3],
                           "max_features": ["sqrt"]}),
        "Logistic Regression": (Pipeline([("scale", StandardScaler()),
                                          ("clf", LogisticRegression(max_iter=5000, random_state=SEED,
                                                                     class_weight=class_weight))]),
                                {"clf__C": [0.1, 1, 10]}),
    }


def plot_confusion(cm: np.ndarray, classes: list[str], title: str, path: str):
    k = len(classes)
    with np.errstate(invalid="ignore", divide="ignore"):
        cmn = np.nan_to_num(cm / cm.sum(axis=1, keepdims=True))
    fig, ax = plt.subplots(figsize=(1.1 * k + 0.5, k + 0.2))
    im = ax.imshow(cmn, cmap="Blues", vmin=0, vmax=1)
    short = [SHORT.get(c, c[:5]) for c in classes]
    ax.set_xticks(range(k), short)
    ax.set_yticks(range(k), short)
    for i in range(k):
        for j in range(k):
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
    """Reconstruct continuous 50 Hz streams from consecutive, 50 %-overlapping UCI held-out windows."""
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
                "id": f"s{subject}-{UCI_CLASSES[cls].lower()}",
                "subject": int(subject),
                "label": UCI_CLASSES[cls],
                "windowIndices": [int(i) for i in best],
                "sampleRateHz": SAMPLE_RATE_HZ,
                "channels": CHANNELS,
                "samples": [[round(float(v), 5) for v in row] for row in stream],
            })
    return sequences


def heldout_subjects(subjects: list[str], frac: float) -> set[str]:
    """round(frac * n) subjects, chosen by a hash of their id (deterministic, independent of file order)."""
    ranked = sorted(subjects, key=lambda s: hashlib.sha256(("split:" + s).encode()).hexdigest())
    return set(ranked[:int(round(frac * len(ranked)))]) if len(ranked) >= 2 else set()


def class_metrics(y_true, proba, classes):
    """Metrics in the schema the app reads (HarModel.metrics.test)."""
    k = len(classes)
    pred = proba.argmax(axis=1)
    p, r, f, sup = precision_recall_fscore_support(y_true, pred, labels=range(k), zero_division=0)
    present = sup > 0  # macro averages over classes that have held-out windows
    conf = proba.max(axis=1)
    correct = (pred == y_true).astype(float)
    bins = np.linspace(0, 1, 11)
    ece, reliability = 0.0, []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            ece += m.mean() * abs(correct[m].mean() - conf[m].mean())
            reliability.append({"bin": [round(float(lo), 1), round(float(hi), 1)], "count": int(m.sum()),
                                "meanConfidence": round(float(conf[m].mean()), 4),
                                "accuracy": round(float(correct[m].mean()), 4)})
    return {
        "accuracy": round(float(accuracy_score(y_true, pred)), 4),
        "macroF1": round(float(np.mean(f[present])), 4),
        "macroPrecision": round(float(np.mean(p[present])), 4),
        "macroRecall": round(float(np.mean(r[present])), 4),
        "expectedCalibrationError": round(float(ece), 4),
        "reliability": reliability,
        "perClass": {classes[i]: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                                  "f1": round(float(f[i]), 4), "support": int(sup[i])} for i in range(k)},
        "confusionMatrix": confusion_matrix(y_true, pred, labels=range(k)).tolist(),
    }


def brief(y_true, pred, k):
    if len(y_true) == 0:
        return None
    p, r, f, sup = precision_recall_fscore_support(y_true, pred, labels=range(k), zero_division=0)
    return {"windows": int(len(y_true)), "accuracy": round(float(accuracy_score(y_true, pred)), 4),
            "macroF1": round(float(np.mean(f[sup > 0])), 4)}


def lr_proba(model, F):
    Z = (F - np.array(model["scaler"]["mean"])) / np.array(model["scaler"]["scale"])
    L = Z @ np.array(model["coef"]).T + np.array(model["intercept"])
    L -= L.max(axis=1, keepdims=True)
    return np.exp(L) / np.exp(L).sum(axis=1, keepdims=True)


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--collected", nargs="*", default=None,
                    help="recording CSVs or folders (default: data/collected/ if it exists)")
    ap.add_argument("--no-collected", action="store_true", help="ignore collected recordings (UCI only)")
    ap.add_argument("--collected-only", action="store_true",
                    help="train on app recordings only (no UCI; UCI is waist-mounted, users mostly use pockets)")
    ap.add_argument("--min-subjects", type=int, default=3, help="min distinct subjects for a class to be exported")
    ap.add_argument("--min-windows", type=int, default=200, help="min windows for a class to be exported")
    ap.add_argument("--collected-test-frac", type=float, default=0.3,
                    help="share of collected subjects held out for evaluation (stable hash; default 0.3)")
    ap.add_argument("--collected-weight", type=float, default=1.0,
                    help="sample weight of collected windows relative to UCI windows (logistic regression)")
    ap.add_argument("--balanced", action="store_true", help="class_weight='balanced' (helps rare classes)")
    ap.add_argument("--refit-all", action="store_true",
                    help="after evaluation, refit the exported models on train + held-out subjects")
    ap.add_argument("--lr-only", action="store_true", help="skip the KNN/SVM/tree/forest comparison (faster)")
    ap.add_argument("--model-version", default="v2", help="modelId suffix: har-logreg-<v>, har-logreg-acc-<v>")
    ap.add_argument("--out-dir", default=DEFAULT_OUT, help="output folder (default ml/har/build/)")
    return ap.parse_args()


def main():
    args = parse_args()
    out = os.path.abspath(args.out_dir)
    os.makedirs(out, exist_ok=True)
    names = feature_names()
    use_uci = not args.collected_only
    class_weight = "balanced" if args.balanced else None

    # ---------- 1. data: one row per window ----------
    parts = []  # dicts of aligned arrays
    if use_uci:
        print("Loading UCI HAR inertial signals ...")
        uci_tr = load_split("train")
        uci_te = load_split("test")
        print(f"  train {uci_tr[0].shape} subjects={len(set(uci_tr[2]))}  "
              f"test {uci_te[0].shape} subjects={len(set(uci_te[2]))}")
        assert not set(uci_tr[2]) & set(uci_te[2]), "subject leakage between official splits"
        uci_map = np.array([ALL_CLASSES.index(c) for c in UCI_CLASSES])
        for split, (X, y, s) in [("train", uci_tr), ("test", uci_te)]:
            F = features_cached(split, X)
            assert F.shape[1] == len(names)
            n = len(y)
            parts.append({"X": X, "F": F, "y": uci_map[y], "group": s.astype(int), "subject": np.array([f"uci-{v}" for v in s]),
                          "source": np.full(n, "uci"), "placement": np.full(n, "waist (UCI)"),
                          "gyro": np.ones(n, bool), "test": np.full(n, split == "test")})

    patterns = [] if args.no_collected else (args.collected if args.collected is not None
                                             else ([DEFAULT_COLLECTED] if os.path.isdir(DEFAULT_COLLECTED) else []))
    n_recordings = 0
    if patterns:
        print(f"Loading collected recordings from {', '.join(patterns)} ...")
        Xc, yc, Fc, meta, n_files = load_collected(patterns)
        if len(Xc):
            subj = np.array([m["subject"] for m in meta])
            uniq = sorted(set(subj.tolist()))
            n_recordings = len({m["recording_id"] for m in meta})
            held = heldout_subjects(uniq, args.collected_test_frac)
            parts.append({"X": Xc, "F": Fc, "y": yc,
                          "group": np.array([COLLECTED_GROUP_BASE + uniq.index(s) for s in subj]),
                          "subject": subj, "source": np.full(len(yc), "collected"),
                          "placement": np.array([m["placement"] for m in meta]),
                          "gyro": np.array([m["gyro"] for m in meta], dtype=bool),
                          "test": np.isin(subj, sorted(held))})
        elif n_files == 0:
            print("  no recording CSVs found")
    if not parts:
        sys.exit("No data: --collected-only needs recordings (run ml/har/fetch_firestore.py first).")
    D = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    is_col = D["source"] == "collected"

    # ---------- 2. per-class data counts and the classes to export ----------
    def eligible(mask):
        kept, reasons = [], {}
        for ci, c in enumerate(ALL_CLASSES):
            m = mask & (D["y"] == ci)
            ns, nw = len(set(D["subject"][m].tolist())), int(m.sum())
            if ns >= args.min_subjects and nw >= args.min_windows:
                kept.append(c)
            else:
                reasons[c] = (f"{ns} subject(s) < {args.min_subjects}" if ns < args.min_subjects else "") + \
                             (", " if ns < args.min_subjects and nw < args.min_windows else "") + \
                             (f"{nw} windows < {args.min_windows}" if nw < args.min_windows else "")
        return kept, reasons

    everything = np.ones(len(D["y"]), bool)
    kept_acc, why_acc = eligible(everything)
    kept_full, why_full = eligible(D["gyro"])

    # collected subjects in the held-out split: make sure each exported class can still be learnt
    for classes, rows in [(kept_acc, everything), (kept_full, D["gyro"])]:
        for c in classes:
            m = rows & (D["y"] == ALL_CLASSES.index(c))
            if not np.any(m & ~D["test"]):
                cand = Counter(D["subject"][m & is_col].tolist()).most_common(1)[0][0]
                D["test"][D["subject"] == cand] = False
                print(f"  note: every {c} subject was in the held-out split; moved subject {cand} to training")

    counts = []
    for ci, c in enumerate(ALL_CLASSES):
        m = D["y"] == ci
        row = {"class": c,
               "uci_subjects": len(set(D["subject"][m & ~is_col].tolist())), "uci_windows": int((m & ~is_col).sum()),
               "collected_subjects": len(set(D["subject"][m & is_col].tolist())),
               "collected_windows": int((m & is_col).sum()),
               "collected_windows_with_gyro": int((m & is_col & D["gyro"]).sum()),
               "total_subjects": len(set(D["subject"][m].tolist())), "total_windows": int(m.sum()),
               "train_windows": int((m & ~D["test"]).sum()), "heldout_windows": int((m & D["test"]).sum()),
               "kept_full": c in kept_full, "kept_acc_only": c in kept_acc,
               "collected_placements": dict(Counter(D["placement"][m & is_col].tolist()))}
        counts.append(row)

    print(f"\nPer-class data (thresholds: >= {args.min_subjects} subjects and >= {args.min_windows} windows"
          f"{'; collected only' if args.collected_only else ''})")
    hdr = f"  {'class':<19}{'UCI subj':>9}{'UCI win':>8}{'coll subj':>10}{'coll win':>9}{'(gyro)':>7}" \
          f"{'train':>7}{'held':>6}  {'acc+gyro':<9}{'acc-only':<9}"
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    for r in counts:
        print(f"  {r['class']:<19}{r['uci_subjects']:>9}{r['uci_windows']:>8}{r['collected_subjects']:>10}"
              f"{r['collected_windows']:>9}{r['collected_windows_with_gyro']:>7}{r['train_windows']:>7}"
              f"{r['heldout_windows']:>6}  {'KEPT' if r['kept_full'] else '-':<9}{'KEPT' if r['kept_acc_only'] else '-':<9}")
    for c, why in why_acc.items():
        print(f"  excluded {c}: {why}")
    for c, why in why_full.items():
        if c in kept_acc:
            print(f"  excluded {c} from the acc+gyro model only: {why} (windows recorded with gyroscope)")
    if any(r["collected_placements"] for r in counts):
        print("  collected windows by placement:")
        for r in counts:
            if r["collected_placements"]:
                print(f"    {r['class']:<19}" + ", ".join(f"{p}: {n}" for p, n in sorted(r["collected_placements"].items())))
    with open(os.path.join(out, "class_counts.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[k for k in counts[0] if k != "collected_placements"],
                           extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(counts)
    if len(kept_full) < 2 or len(kept_acc) < 2:
        sys.exit("Fewer than two classes meet the thresholds; collect more data or lower --min-subjects/--min-windows.")
    print(f"\nExported classes (acc+gyro): {kept_full}\nExported classes (acc-only): {kept_acc}")

    # ---------- 3. variants ----------
    acc_idx = [i for i, n in enumerate(names) if "gyro" not in n]

    def variant(classes, row_mask, cols):
        m = row_mask & np.isin(D["y"], [ALL_CLASSES.index(c) for c in classes])
        remap = {ALL_CLASSES.index(c): i for i, c in enumerate(classes)}
        y = np.array([remap[v] for v in D["y"][m]], dtype=int)
        te = D["test"][m]
        w = np.where(D["source"][m] == "collected", args.collected_weight, 1.0)
        return {"classes": classes, "cols": cols, "idx": np.where(m)[0], "F": D["F"][m][:, cols], "y": y,
                "group": D["group"][m], "test": te, "source": D["source"][m], "placement": D["placement"][m],
                "sw": None if np.all(w == 1.0) else w}

    V = {"full": variant(kept_full, D["gyro"], list(range(len(names)))),
         "acc_only": variant(kept_acc, everything, acc_idx)}

    def split(v):
        tr, te = ~v["test"], v["test"]
        return v["F"][tr], v["y"][tr], v["group"][tr], v["F"][te], v["y"][te], (None if v["sw"] is None else v["sw"][tr])

    full = V["full"]
    F_tr, y_tr, g_tr, F_te, y_te, sw_tr = split(full)
    k_full = len(full["classes"])
    n_groups = len(set(g_tr.tolist()))
    if n_groups < 2:
        sys.exit("Need at least two training subjects for grouped cross-validation.")
    cv = GroupKFold(n_splits=min(5, n_groups))
    heldout = len(y_te) > 0
    eval_desc = ("held-out subjects" if heldout else
                 f"out-of-fold predictions, {cv.n_splits}-fold subject-grouped CV (no held-out subjects)")
    print(f"\nTraining windows {len(y_tr)} from {n_groups} subjects; evaluation on {eval_desc}"
          f"{f' ({len(y_te)} windows)' if heldout else ''}")

    def predict_eval(est, Ftr, ytr, gtr, Fte, sw=None, proba=False):
        """Predictions on held-out subjects, or out-of-fold predictions when there are none."""
        method = "predict_proba" if proba else "predict"
        if heldout:
            return getattr(est, method)(Fte)
        params = {} if sw is None else {"clf__sample_weight": sw}
        return cross_val_predict(clone(est), Ftr, ytr, groups=gtr, cv=cv, method=method, params=params)

    # ---------- 4. model comparison / hyper-parameters (acc+gyro variant) ----------
    os.makedirs(out, exist_ok=True)
    results = {}
    models = candidate_models(class_weight)
    if args.lr_only:
        models = {"Logistic Regression": models["Logistic Regression"]}
    for name, (est, grid) in models.items():
        t = time.time()
        gs = GridSearchCV(est, grid, cv=cv, scoring="f1_macro", n_jobs=-1)
        fit_params = {"clf__sample_weight": sw_tr} if (sw_tr is not None and name == "Logistic Regression") else {}
        gs.fit(F_tr, y_tr, groups=g_tr, **fit_params)
        best = gs.best_estimator_
        y_eval = y_te if heldout else y_tr
        pred = predict_eval(best, F_tr, y_tr, g_tr, F_te, sw_tr if name == "Logistic Regression" else None)
        p, r, f, sup = precision_recall_fscore_support(y_eval, pred, labels=range(k_full), zero_division=0)
        present = sup > 0
        cm = confusion_matrix(y_eval, pred, labels=range(k_full))
        results[name] = {
            "bestParams": {kk: (v if not isinstance(v, np.generic) else v.item()) for kk, v in gs.best_params_.items()},
            "cvMacroF1": round(float(gs.best_score_), 4),
            "testAccuracy": round(float(accuracy_score(y_eval, pred)), 4),
            "testMacroF1": round(float(np.mean(f[present])), 4),
            "testMacroPrecision": round(float(np.mean(p[present])), 4),
            "testMacroRecall": round(float(np.mean(r[present])), 4),
            "perClass": {full["classes"][i]: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                                              "f1": round(float(f[i]), 4), "support": int(sup[i])} for i in range(k_full)},
            "confusionMatrix": cm.tolist(),
            "trainSeconds": round(time.time() - t, 1),
        }
        plot_confusion(cm, full["classes"], f"{name} - {'held-out' if heldout else 'out-of-fold'}",
                       os.path.join(out, f"cm_{name.split()[0].lower()}.png"))
        print(f"  {name:20s} cvF1={gs.best_score_:.4f} testAcc={results[name]['testAccuracy']:.4f} "
              f"testF1={results[name]['testMacroF1']:.4f} params={gs.best_params_}")
        print(classification_report(y_eval, pred, labels=range(k_full), target_names=full["classes"], digits=4,
                                    zero_division=0))

    # ---------- 5. deployable models ----------
    # Multinomial logistic regression: within ~1.5 points of the RBF SVM on UCI, ~100x smaller, native
    # softmax probabilities and pure dot products in TypeScript (see docs/ML_REPORT.md).
    lr_C = results["Logistic Regression"]["bestParams"]["clf__C"]
    uci_tr_subj = sorted(int(s) for s in set(D["group"][(D["source"] == "uci") & ~D["test"]].tolist()))
    uci_te_subj = sorted(int(s) for s in set(D["group"][(D["source"] == "uci") & D["test"]].tolist()))
    col_subj = set(D["subject"][is_col].tolist())
    col_te_subj = set(D["subject"][is_col & D["test"]].tolist())
    excluded = [c for c in ALL_CLASSES if c not in kept_acc]

    if use_uci and not is_col.any():
        ds_name, ds_license = "UCI Human Activity Recognition Using Smartphones", "CC BY 4.0"
        split_desc = "official subject-separated split (21 train / 9 test subjects)"
    elif use_uci:
        ds_name = "UCI Human Activity Recognition Using Smartphones + WellTrack consented recordings"
        ds_license = "UCI: CC BY 4.0; recordings: consented WellTrack users, not redistributable"
        split_desc = (f"UCI official split (21 train / 9 test subjects) + {len(col_subj) - len(col_te_subj)} train / "
                      f"{len(col_te_subj)} held-out WellTrack subjects")
    else:
        ds_name, ds_license = "WellTrack consented recordings", "consented WellTrack users, not redistributable"
        split_desc = f"{len(col_subj) - len(col_te_subj)} train / {len(col_te_subj)} held-out WellTrack subjects"

    exported = {}
    sensors = {"full": "accelerometer + gyroscope", "acc_only": "accelerometer only (fallback when no gyroscope)"}
    ids = {"full": f"har-logreg-{args.model_version}", "acc_only": f"har-logreg-acc-{args.model_version}"}
    for key, v in V.items():
        classes, cols, k = v["classes"], v["cols"], len(v["classes"])
        Ftr, ytr, gtr, Fte, yte, swtr = split(v)

        def fit(F, y, sw):
            scaler = StandardScaler().fit(F)
            clf = LogisticRegression(C=lr_C, max_iter=5000, random_state=SEED, class_weight=class_weight)
            clf.fit(scaler.transform(F), y, sample_weight=sw)
            return scaler, clf

        scaler, clf = fit(Ftr, ytr, swtr)
        if heldout and len(yte):
            proba = clf.predict_proba(scaler.transform(Fte))
            y_eval, src_eval, plc_eval = yte, v["source"][v["test"]], v["placement"][v["test"]]
        else:
            pipe = Pipeline([("scale", StandardScaler()),
                             ("clf", LogisticRegression(C=lr_C, max_iter=5000, random_state=SEED, class_weight=class_weight))])
            params = {} if swtr is None else {"clf__sample_weight": swtr}
            proba = cross_val_predict(pipe, Ftr, ytr, groups=gtr, cv=GroupKFold(n_splits=min(5, len(set(gtr.tolist())))),
                                      method="predict_proba", params=params)
            y_eval, src_eval, plc_eval = ytr, v["source"][~v["test"]], v["placement"][~v["test"]]
        metrics = class_metrics(y_eval, proba, classes)
        metrics["evaluation"] = eval_desc
        dp = proba.argmax(axis=1)
        metrics["bySource"] = {s: brief(y_eval[src_eval == s], dp[src_eval == s], k) for s in sorted(set(src_eval.tolist()))}
        metrics["byPlacement"] = {p: brief(y_eval[plc_eval == p], dp[plc_eval == p], k) for p in sorted(set(plc_eval.tolist()))}
        plot_confusion(np.array(metrics["confusionMatrix"]), classes, f"Deployed {ids[key]} - {'held-out' if heldout else 'out-of-fold'}",
                       os.path.join(out, f"cm_deployed_{key}.png"))
        print(f"Deployed {ids[key]}: acc={metrics['accuracy']} macroF1={metrics['macroF1']} "
              f"ECE={metrics['expectedCalibrationError']}  by source: {metrics['bySource']}")

        if args.refit_all:
            scaler, clf = fit(v["F"], v["y"], v["sw"])
        assert list(clf.classes_) == list(range(k)), "a class has no training windows"

        # verify the exported math (standardise -> softmax(Wx+b)) reproduces sklearn
        Z = scaler.transform(v["F"][:500])
        logits = Z @ clf.coef_.T + clf.intercept_
        logits -= logits.max(axis=1, keepdims=True)
        mine = np.exp(logits) / np.exp(logits).sum(axis=1, keepdims=True)
        assert np.allclose(mine, clf.predict_proba(Z), atol=1e-9)

        # how windows of classes the model does not know are classified (e.g. RUNNING before it is kept)
        unknown = {}
        for c in ALL_CLASSES:
            if c in classes:
                continue
            m = (D["y"] == ALL_CLASSES.index(c)) & (D["gyro"] if key == "full" else everything)
            if m.any():
                pr = clf.predict(scaler.transform(D["F"][m][:, cols]))
                unknown[c] = {"windows": int(m.sum()),
                              "predictedAs": {classes[i]: int(n) for i, n in Counter(pr.tolist()).most_common()}}
        if unknown:
            metrics["excludedClassPredictions"] = unknown
            print(f"  windows of excluded classes classified as: {unknown}")

        coef_abs = np.abs(clf.coef_).mean(axis=0)
        top = sorted(zip([names[c] for c in cols], coef_abs), key=lambda t: -t[1])[:15]
        n_tr = int(len(v["y"]) if args.refit_all else len(ytr))
        limitations = [
            "Held-out accuracy is measured on recorded subjects, not on live phones; live accuracy is not guaranteed.",
            "Softmax probabilities were checked for calibration on held-out subjects only (see ECE); they are not calibrated for live phones.",
            f"Only {k} activities are recognised ({', '.join(classes)}); anything else is mapped to the closest known class.",
        ]
        if use_uci:
            limitations.insert(0, "UCI windows come from a waist-mounted Samsung Galaxy S II (landscape, on the belt); "
                                  "other placements and orientations shift the input distribution.")
        exported[key] = {
            "modelId": ids[key],
            "task": "human_activity_recognition",
            "type": "logistic_regression",
            "sensors": sensors[key],
            "classes": classes,
            "featureNames": [names[c] for c in cols],
            "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
            "coef": clf.coef_.tolist(),
            "intercept": clf.intercept_.tolist(),
            "preprocessing": {
                "sampleRateHz": SAMPLE_RATE_HZ, "windowSize": WINDOW_SIZE, "windowStep": WINDOW_STEP,
                "channels": CHANNELS, "accelerometerUnits": "g (gravity included, Android axis/sign convention)",
                "gyroscopeUnits": "rad/s", "filter": "3-point median per channel",
            },
            "hyperparameters": {"C": lr_C, "penalty": "l2", "multiClass": "multinomial (softmax)",
                                "classWeight": class_weight, "collectedSampleWeight": args.collected_weight,
                                "refitOnAllSubjects": bool(args.refit_all)},
            "metrics": {"test": metrics,
                        "comparison": {kk: {"accuracy": vv["testAccuracy"], "macroF1": vv["testMacroF1"],
                                            "cvMacroF1": vv["cvMacroF1"]} for kk, vv in results.items()}},
            "featureImportanceTop": [{"feature": n, "meanAbsStdCoef": round(float(val), 4)} for n, val in top],
            "dataset": {
                "name": ds_name,
                "source": "https://archive.ics.uci.edu/dataset/240/human+activity+recognition+using+smartphones"
                          if use_uci else "WellTrack in-app collection (Firestore harRecordings)",
                "license": ds_license,
                "trainWindows": n_tr, "testWindows": int(len(yte)),
                "trainSubjects": uci_tr_subj, "testSubjects": uci_te_subj,
                "split": split_desc,
                "evaluation": f"{eval_desc}: {len(y_eval):,} windows"
                              + (" (metrics describe the model before refitting on all subjects)" if args.refit_all else ""),
                "collected": {"recordings": n_recordings, "subjects": len(col_subj),
                              "heldOutSubjects": len(col_te_subj),
                              "windows": int(np.sum(v["source"] == "collected"))} if col_subj else None,
                "excludedClasses": [c for c in ALL_CLASSES if c not in classes],
                "selectionRule": f">= {args.min_subjects} subjects and >= {args.min_windows} windows per class",
            },
            "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sklearnVersion": sklearn.__version__,
            "limitations": limitations,
        }

    for key, fname in [("full", "har_model.json"), ("acc_only", "har_model_acc.json")]:
        path = os.path.join(out, fname)
        with open(path, "w") as fh:
            json.dump(exported[key], fh, separators=(",", ":"))
        print(f"Exported {path} ({os.path.getsize(path) / 1024:.0f} KB)")

    # ---------- 6. parity fixtures: rounded raw windows -> python features -> predictions ----------
    rng = np.random.default_rng(SEED)
    pool = full["idx"][full["test"]] if heldout else full["idx"][~full["test"]]
    pool_y = full["y"][full["test"]] if heldout else full["y"][~full["test"]]
    pick = []
    for cls in range(k_full):
        cand = pool[pool_y == cls]
        if len(cand):
            pick += rng.choice(cand, size=min(8, len(cand)), replace=False).tolist()
    windows = np.round(D["X"][pick], 6)
    F_fix = extract_batch(windows)
    proba = lr_proba(exported["full"], F_fix)
    proba_acc = lr_proba(exported["acc_only"], F_fix[:, acc_idx])
    acc_classes = exported["acc_only"]["classes"]
    first_test = int(np.argmax(D["test"])) if D["test"].any() else 0  # index relative to the UCI test split
    fixtures = {
        "featureNames": names,
        "modelIds": {"full": ids["full"], "accOnly": ids["acc_only"]},
        "classes": full["classes"], "classesAccOnly": acc_classes,
        "cases": [{"index": int(i - first_test) if D["source"][i] == "uci" else int(i), "source": str(D["source"][i]),
                   "label": ALL_CLASSES[D["y"][i]], "window": w.tolist(),
                   "features": f.tolist(), "proba": pr.tolist(), "predicted": full["classes"][int(pr.argmax())],
                   "probaAccOnly": pa.tolist(), "predictedAccOnly": acc_classes[int(pa.argmax())]}
                  for i, w, f, pr, pa in zip(pick, windows, F_fix, proba, proba_acc)],
    }
    with open(os.path.join(out, "har_fixtures.json"), "w") as fh:
        json.dump(fixtures, fh)

    if use_uci:
        replay = build_replay(*uci_te)
        with open(os.path.join(out, "har_replay.json"), "w") as fh:
            json.dump({"source": "UCI HAR held-out TEST subjects (never used for training)",
                       "license": "CC BY 4.0", "sequences": replay}, fh, separators=(",", ":"))

    with open(os.path.join(out, "metrics.json"), "w") as fh:
        json.dump({"models": results, "deployed": exported["full"]["metrics"]["test"], "featureCount": len(names),
                   "deployedAccOnly": exported["acc_only"]["metrics"]["test"], "classCounts": counts,
                   "keptClasses": {"full": kept_full, "accOnly": kept_acc},
                   "config": {k: v for k, v in vars(args).items() if k != "collected"}}, fh, indent=2)
    print(f"Done. Outputs in {out}")


if __name__ == "__main__":
    main()
