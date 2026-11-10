"""
WellTrack AI - load labelled recordings collected with the app.

Usage (from the repository root):
    python -I ml/har/collected.py data/collected                     # folders are searched recursively
    python -I ml/har/collected.py data/collected/*.csv --save ml/har/cache/collected_windows.npz

The CSV holds the app's 50 Hz resampled stream (acc in g with gravity, Android/UCI sign convention;
gyro in rad/s), one row per sample:
    recording_id,label,placement,platform,device,segment,t,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z
Columns match src/features/activity/harRecordingFormat.ts. Files come either from the in-app share-sheet
export or from ml/har/fetch_firestore.py; other CSVs (subjects.csv, research_days.csv) are ignored by
checking the header. Windows (128 samples, 64 step) are cut within each (recording_id, segment) only,
exactly like the live SensorWindower, so no window spans a sensor gap. The deployed models from models/
are then scored on those windows per label and placement.

Subjects: fetch_firestore.py prefixes recording ids with "s<hash>_" and writes subjects.csv; recordings
without such a prefix (manual exports) are all attributed to one subject, "local".
"""
from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from features import WINDOW_SIZE, WINDOW_STEP, extract_batch, feature_names  # noqa: E402

# Label set the app records. RUNNING has no UCI counterpart.
CLASSES = ["WALKING", "RUNNING", "WALKING_UPSTAIRS", "WALKING_DOWNSTAIRS", "SITTING", "STANDING", "LAYING"]
SHORT = {"WALKING": "Walk", "RUNNING": "Run", "WALKING_UPSTAIRS": "Up", "WALKING_DOWNSTAIRS": "Down",
         "SITTING": "Sit", "STANDING": "Stand", "LAYING": "Lay"}
SIGNAL_COLS = ["acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]
CSV_HEADER = "recording_id,label,placement,platform,device,segment,t," + ",".join(SIGNAL_COLS)
LOCAL_SUBJECT = "local"
SUBJECT_PREFIX = re.compile(r"^(s[0-9a-f]{10})_")
CACHE = os.path.join(HERE, "cache", "collected")


def find_recording_csvs(patterns: list[str]) -> list[str]:
    """Expands globs and folders (recursively) and keeps only files with the recording CSV header."""
    paths = set()
    for pattern in patterns:
        if os.path.isdir(pattern):
            paths.update(glob.glob(os.path.join(pattern, "**", "*.csv"), recursive=True))
        else:
            paths.update(glob.glob(pattern))
    keep = []
    for p in sorted(paths):
        with open(p, encoding="utf-8") as fh:
            if fh.readline().strip().lstrip("﻿") == CSV_HEADER:
                keep.append(p)
    return keep


def load_subject_maps(paths: list[str]) -> dict[str, str]:
    """recording_id -> subject from every subjects.csv next to (or one level above) the recording files."""
    mapping: dict[str, str] = {}
    dirs = {os.path.dirname(os.path.abspath(p)) for p in paths}
    for d in sorted(dirs | {os.path.dirname(d) for d in dirs}):
        f = os.path.join(d, "subjects.csv")
        if os.path.exists(f):
            with open(f, newline="", encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    mapping[r["recording_id"]] = r["subject"]
    return mapping


def subject_of(recording_id: str, mapping: dict[str, str]) -> str:
    if recording_id in mapping:
        return mapping[recording_id]
    m = SUBJECT_PREFIX.match(recording_id)
    return m.group(1) if m else LOCAL_SUBJECT


def load_rows(paths: list[str]):
    """Groups samples by (recording_id, segment); later files win if a recording appears twice."""
    segments: dict[tuple[str, int], dict] = {}
    for path in paths:
        seen_here: set[tuple[str, int]] = set()
        with open(path, newline="", encoding="utf-8-sig") as fh:
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


def to_windows(segments, subjects: dict[str, str] | None = None):
    X, y, meta = [], [], []
    for (rec, seg), s in sorted(segments.items()):
        if s["label"] not in CLASSES:
            continue
        a = np.asarray(s["samples"], dtype=np.float64).T  # (6, n)
        for start in range(0, a.shape[1] - WINDOW_SIZE + 1, WINDOW_STEP):
            X.append(a[:, start:start + WINDOW_SIZE])
            y.append(CLASSES.index(s["label"]))
            meta.append({"recording_id": rec, "segment": seg, "placement": s["placement"],
                         "platform": s["platform"], "device": s["device"], "gyro": s["gyro"],
                         "subject": subject_of(rec, subjects or {})})
    X = np.stack(X) if X else np.zeros((0, 6, WINDOW_SIZE))
    return X, np.asarray(y, dtype=int), meta


def load_collected(patterns: list[str], verbose: bool = True):
    """Windows + features for every recording CSV matched by `patterns`.

    Returns (X (n,6,128), y (indices into CLASSES), F (n,82), meta list, n_files). Features are cached
    per file content in ml/har/cache/collected/. If a recording id appears in several files, the
    last file (sorted path order) wins, as in load_rows.
    """
    paths = find_recording_csvs(patterns)
    subjects = load_subject_maps(paths)
    per_file = []
    os.makedirs(CACHE, exist_ok=True)
    for path in paths:
        with open(path, "rb") as fh:
            digest = hashlib.sha1(fh.read()).hexdigest()
        cache = os.path.join(CACHE, f"{digest}.npz")
        if os.path.exists(cache):
            z = np.load(cache, allow_pickle=False)
            X, y, F = z["X"], z["y"], z["F"]
            meta = json.loads(str(z["meta"]))
        else:
            X, y, meta = to_windows(load_rows([path]))
            F = extract_batch(X) if len(X) else np.zeros((0, len(feature_names())))
            np.savez_compressed(cache, X=X, y=y, F=F, meta=json.dumps(meta))
        for m in meta:  # subject mapping can change after caching (e.g. a new subjects.csv)
            m["subject"] = subject_of(m["recording_id"], subjects)
        per_file.append((X, y, F, meta))

    owner = {}
    for i, (_, _, _, meta) in enumerate(per_file):
        for m in meta:
            owner[m["recording_id"]] = i
    Xs, ys, Fs, metas = [], [], [], []
    for i, (X, y, F, meta) in enumerate(per_file):
        keep = np.array([owner[m["recording_id"]] == i for m in meta], dtype=bool)
        if keep.any():
            Xs.append(X[keep])
            ys.append(y[keep])
            Fs.append(F[keep])
            metas += [m for m, k in zip(meta, keep) if k]
    if not Xs:
        return np.zeros((0, 6, WINDOW_SIZE)), np.zeros(0, dtype=int), np.zeros((0, len(feature_names()))), [], len(paths)
    X, y, F = np.concatenate(Xs), np.concatenate(ys), np.concatenate(Fs)
    if verbose:
        recs = {m["recording_id"] for m in metas}
        subs = {m["subject"] for m in metas}
        print(f"  collected: {len(paths)} file(s), {len(recs)} recording(s), {len(subs)} subject(s) -> {len(X)} windows")
    return X, y, F, metas, len(paths)


def lr_proba(model, F):
    Z = (F - np.array(model["scaler"]["mean"])) / np.array(model["scaler"]["scale"])
    L = Z @ np.array(model["coef"]).T + np.array(model["intercept"])
    L -= L.max(axis=1, keepdims=True)
    return np.exp(L) / np.exp(L).sum(axis=1, keepdims=True)


def score(name, model, F_all, y, mask):
    """Rows = recorded label (CLASSES), columns = the model's own classes."""
    if not mask.any():
        return
    cols = [feature_names().index(n) for n in model["featureNames"]]
    pred_idx = lr_proba(model, F_all[mask][:, cols]).argmax(axis=1)
    pred = np.array([model["classes"][p] for p in pred_idx])
    truth = np.array([CLASSES[t] for t in y[mask]])
    known = np.isin(truth, model["classes"])
    acc = f"{np.mean(pred[known] == truth[known]):.1%} of {known.sum()} windows correct" if known.any() else "no known labels"
    print(f"\n{name} ({model['modelId']}): {acc}"
          + (f"; {(~known).sum()} windows of labels the model does not know" if (~known).any() else ""))
    print("        " + " ".join(f"{SHORT.get(c, c[:6]):>6}" for c in model["classes"]) + "   (rows = recorded label)")
    for lab in CLASSES:
        rows = truth == lab
        if rows.any():
            print(f"{SHORT[lab]:>6}  " + " ".join(f"{int(np.sum(pred[rows] == c)):>6}" for c in model["classes"]))
    return pred


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+", help="CSV exports or folders (globs allowed)")
    ap.add_argument("--save", help="write windows, labels, features and metadata to this .npz")
    args = ap.parse_args()

    X, y, F, meta, n_files = load_collected(args.csv, verbose=False)
    if not n_files:
        sys.exit("No recording CSV files matched.")
    recordings = {m["recording_id"] for m in meta}
    print(f"{n_files} file(s), {len(recordings)} recording(s), "
          f"{len({m['subject'] for m in meta})} subject(s) -> {len(X)} windows")
    if len(X) == 0:
        sys.exit("No complete 2.56 s windows found.")

    by_label = defaultdict(lambda: defaultdict(int))
    for m, lab in zip(meta, y):
        by_label[CLASSES[lab]][m["placement"]] += 1
    print("\nWindows per label and placement:")
    for lab in CLASSES:
        if by_label[lab]:
            print(f"  {lab:<20} " + ", ".join(f"{p}: {n}" for p, n in sorted(by_label[lab].items())))

    with open(os.path.join(ROOT, "models", "har_model.json")) as fh:
        full = json.load(fh)
    with open(os.path.join(ROOT, "models", "har_model_acc.json")) as fh:
        acc_only = json.load(fh)
    gyro = np.array([m["gyro"] for m in meta])
    placements = np.array([m["placement"] for m in meta])

    print("\n=== Deployed models on your recordings ===")
    score("Acc + gyro model, all placements", full, F, y, gyro)
    score("Accelerometer-only model, all recordings", acc_only, F, y, np.ones(len(y), dtype=bool))
    for p in sorted(set(placements)):
        mask = gyro & (placements == p)
        if mask.any():
            score(f"Acc + gyro model, placement = {p}", full, F, y, mask)

    if args.save:
        os.makedirs(os.path.dirname(os.path.abspath(args.save)), exist_ok=True)
        np.savez_compressed(args.save, X=X, y=y, F=F, classes=np.array(CLASSES),
                            recording_id=np.array([m["recording_id"] for m in meta]),
                            subject=np.array([m["subject"] for m in meta]),
                            placement=placements, gyro=gyro)
        print(f"\nSaved {len(X)} windows to {args.save}")


if __name__ == "__main__":
    main()
