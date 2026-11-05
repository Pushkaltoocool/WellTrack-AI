"""
WellTrack AI - load labelled recordings exported from the app (Activity > Collect movement data).

Usage (from the repository root):
    python -I ml/har/collected.py data/collected/*.csv
    python -I ml/har/collected.py data/collected/*.csv --save ml/har/cache/collected_windows.npz

The CSV holds the app's 50 Hz resampled stream (acc in g with gravity, Android/UCI sign convention;
gyro in rad/s), one row per sample:
    recording_id,label,placement,platform,device,segment,t,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z
Columns match src/features/activity/harRecordingFormat.ts. Windows (128 samples, 64 step) are cut
within each (recording_id, segment) only, exactly like the live SensorWindower, so no window spans a
sensor gap. The deployed models from models/ are then scored on those windows per label and placement.
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from features import WINDOW_SIZE, WINDOW_STEP, extract_batch, feature_names  # noqa: E402

CLASSES = ["WALKING", "WALKING_UPSTAIRS", "WALKING_DOWNSTAIRS", "SITTING", "STANDING", "LAYING"]
SIGNAL_COLS = ["acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]


def load_rows(paths: list[str]):
    """Groups samples by (recording_id, segment); later files win if a recording appears twice."""
    segments: dict[tuple[str, int], dict] = {}
    for path in paths:
        seen_here: set[tuple[str, int]] = set()
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                key = (row["recording_id"], int(row["segment"]))
                if key not in seen_here:
                    seen_here.add(key)
                    segments[key] = {"label": row["label"], "placement": row["placement"],
                                     "platform": row["platform"], "device": row["device"], "samples": []}
                gyro_missing = row["gyro_x"] == ""
                segments[key]["gyro"] = not gyro_missing
                segments[key]["samples"].append(
                    [float(row[c]) if row[c] != "" else 0.0 for c in SIGNAL_COLS])
    return segments


def to_windows(segments):
    X, y, meta = [], [], []
    for (rec, seg), s in sorted(segments.items()):
        if s["label"] not in CLASSES:
            continue
        a = np.asarray(s["samples"], dtype=np.float64).T  # (6, n)
        for start in range(0, a.shape[1] - WINDOW_SIZE + 1, WINDOW_STEP):
            X.append(a[:, start:start + WINDOW_SIZE])
            y.append(CLASSES.index(s["label"]))
            meta.append({"recording_id": rec, "segment": seg, "placement": s["placement"],
                         "platform": s["platform"], "device": s["device"], "gyro": s["gyro"]})
    X = np.stack(X) if X else np.zeros((0, 6, WINDOW_SIZE))
    return X, np.asarray(y, dtype=int), meta


def lr_proba(model, F):
    Z = (F - np.array(model["scaler"]["mean"])) / np.array(model["scaler"]["scale"])
    L = Z @ np.array(model["coef"]).T + np.array(model["intercept"])
    L -= L.max(axis=1, keepdims=True)
    return np.exp(L) / np.exp(L).sum(axis=1, keepdims=True)


def score(name, model, F_all, y, mask):
    if not mask.any():
        return
    cols = [feature_names().index(n) for n in model["featureNames"]]
    pred = lr_proba(model, F_all[mask][:, cols]).argmax(axis=1)
    truth = y[mask]
    print(f"\n{name} ({model['modelId']}): {np.mean(pred == truth):.1%} of {mask.sum()} windows correct")
    cm = np.zeros((6, 6), dtype=int)
    for t, p in zip(truth, pred):
        cm[t, p] += 1
    short = ["Walk", "Up", "Down", "Sit", "Stand", "Lay"]
    print("        " + " ".join(f"{s:>6}" for s in short) + "   (rows = recorded label)")
    for i, s in enumerate(short):
        if cm[i].sum():
            print(f"{s:>6}  " + " ".join(f"{v:>6}" for v in cm[i]))
    return pred


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+", help="CSV exports from the app (globs allowed)")
    ap.add_argument("--save", help="write windows, labels, features and metadata to this .npz")
    args = ap.parse_args()

    paths = sorted({p for pattern in args.csv for p in glob.glob(pattern)})
    if not paths:
        sys.exit("No CSV files matched.")
    segments = load_rows(paths)
    X, y, meta = to_windows(segments)
    recordings = {m["recording_id"] for m in meta}
    print(f"{len(paths)} file(s), {len(recordings)} recording(s), {len(segments)} segment(s) -> {len(X)} windows")
    if len(X) == 0:
        sys.exit("No complete 2.56 s windows found.")

    by_label = defaultdict(lambda: defaultdict(int))
    for m, lab in zip(meta, y):
        by_label[CLASSES[lab]][m["placement"]] += 1
    print("\nWindows per label and placement:")
    for lab in CLASSES:
        if by_label[lab]:
            print(f"  {lab:<20} " + ", ".join(f"{p}: {n}" for p, n in sorted(by_label[lab].items())))

    F = extract_batch(X)
    with open(os.path.join(ROOT, "models", "har_model.json")) as fh:
        full = json.load(fh)
    with open(os.path.join(ROOT, "models", "har_model_acc.json")) as fh:
        acc_only = json.load(fh)
    gyro = np.array([m["gyro"] for m in meta])
    placements = np.array([m["placement"] for m in meta])

    print("\n=== Deployed UCI-trained models on your recordings ===")
    score("Acc + gyro model, all placements", full, F, y, gyro)
    score("Accelerometer-only model, all recordings", acc_only, F, y, np.ones(len(y), dtype=bool))
    for p in sorted(set(placements)):
        mask = gyro & (placements == p)
        if mask.any():
            score(f"Acc + gyro model, placement = {p}", full, F, y, mask)

    if args.save:
        os.makedirs(os.path.dirname(os.path.abspath(args.save)), exist_ok=True)
        np.savez_compressed(args.save, X=X, y=y, F=F,
                            recording_id=np.array([m["recording_id"] for m in meta]),
                            placement=placements, gyro=gyro)
        print(f"\nSaved {len(X)} windows to {args.save}")


if __name__ == "__main__":
    main()
