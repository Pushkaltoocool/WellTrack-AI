"""
WellTrack AI - download consented HAR recordings and research days from Firestore.

Usage (from the repository root):
    python -I ml/har/fetch_firestore.py --key <service-account.json> [--out DIR] [--since YYYY-MM-DD]

Reads (Firebase Admin SDK, bypasses security rules, so keep the key private and out of git):
    users/{uid}/harRecordings/{recordingId}            recording metadata (only complete == true)
    users/{uid}/harRecordings/{recordingId}/chunks/NNN  int16le acc / gyro sample chunks
    users/{uid}/researchDays/{YYYY-MM-DD}              daily stress-research rows

Writes (default DIR = data/collected/firestore/):
    DIR/recordings/<rec>.csv   one CSV per recording, the layout ml/har/collected.py reads
                               (CSV_HEADER in src/features/activity/harRecordingFormat.ts)
    DIR/subjects.csv           recording_id -> subject (salted short hash of the uid, never the uid)
    DIR/research_days.csv      every researchDays doc flattened to one row (rewritten each run)

<rec> is "s<subject hash>_<recordingId>". Recordings whose CSV already exists are skipped, so runs are
incremental. `t` is reconstructed as (index within its segment) / 50 s. A run without --since also deletes
local copies of recordings that are no longer in Firestore (withdrawn by the user) and rewrites
research_days.csv from scratch, so withdrawals propagate; --since runs only add or refresh.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import os
import re
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "data", "collected", "firestore")

CSV_HEADER = ["recording_id", "label", "placement", "platform", "device", "segment", "t",
              "acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]
CLASSES = ["WALKING", "RUNNING", "WALKING_UPSTAIRS", "WALKING_DOWNSTAIRS", "SITTING", "STANDING", "LAYING"]
PLACEMENTS = ["waist", "pocket", "hand", "bag"]
SAMPLE_RATE_HZ = 50
SUPPORTED_SCHEMA = 1
SUBJECT_SALT = "welltrack-har-subject:"
CHECKIN_FIELDS = ["sleepHours", "studyHours", "academicPressure", "screenTimeHours",
                  "physicalActivityMinutes", "socialHours", "extracurricularHours"]
MOTION_TYPES = ["stationary", "walking", "running", "automotive", "cycling", "unknown"]


SUBJECT_FILE = re.compile(r"^s[0-9a-f]{10}_.+\.csv$")


class RecordingError(ValueError):
    """A recording whose stored chunks do not match its metadata."""


def subject_hash(uid: str) -> str:
    """Short, stable pseudonym for a uid (40 bits; unique enough for a cohort, not reversible from the CSV)."""
    return "s" + hashlib.sha256((SUBJECT_SALT + uid).encode("utf-8")).hexdigest()[:10]


def csv_safe(s) -> str:
    """Mirror of csvSafe() in harRecordingFormat.ts."""
    return re.sub(r"[^A-Za-z0-9 ._-]", "", str(s or "")).strip() or "unknown"


def output_name(subject: str, recording_id: str) -> str:
    return f"{subject}_{csv_safe(recording_id).replace(' ', '_')}"


def decode_chunks(meta: dict, chunks: list[dict]):
    """Returns (segment[n] int, t[n] float s, acc[n,3] g, gyro[n,3] rad/s or None) for one recording.

    `meta` is the recording doc, `chunks` the chunk docs in any order. Raises RecordingError when the
    chunks are missing, overlapping or inconsistent with the metadata.
    """
    if meta.get("encoding") != "int16le":
        raise RecordingError(f"unsupported encoding {meta.get('encoding')!r}")
    if int(meta.get("sampleRateHz", 0)) != SAMPLE_RATE_HZ:
        raise RecordingError(f"unsupported sampleRateHz {meta.get('sampleRateHz')!r}")
    acc_scale = float(meta["accScale"])
    gyro_scale = float(meta["gyroScale"]) if meta.get("gyroScale") is not None else None
    use_gyro = bool(meta.get("useGyro"))
    chunks = sorted(chunks, key=lambda c: int(c["index"]))
    if "chunkCount" in meta and len(chunks) != int(meta["chunkCount"]):
        raise RecordingError(f"{len(chunks)} chunks stored, chunkCount = {meta['chunkCount']}")

    acc_parts, gyro_parts, seg_parts = [], [], []
    expected_start = 0
    for i, c in enumerate(chunks):
        if int(c["index"]) != i:
            raise RecordingError(f"chunk index {c['index']} where {i} was expected")
        count = int(c["count"])
        if int(c["start"]) != expected_start:
            raise RecordingError(f"chunk {i} starts at {c['start']}, expected {expected_start}")
        acc_bytes = bytes(c["acc"])
        if len(acc_bytes) != count * 6:
            raise RecordingError(f"chunk {i}: acc has {len(acc_bytes)} bytes for {count} samples")
        acc_parts.append(np.frombuffer(acc_bytes, dtype="<i2").reshape(count, 3).astype(np.float64) * acc_scale)
        if use_gyro:
            if c.get("gyro") is None or gyro_scale is None:
                raise RecordingError(f"chunk {i}: useGyro is true but gyro is missing")
            gyro_bytes = bytes(c["gyro"])
            if len(gyro_bytes) != count * 6:
                raise RecordingError(f"chunk {i}: gyro has {len(gyro_bytes)} bytes for {count} samples")
            gyro_parts.append(np.frombuffer(gyro_bytes, dtype="<i2").reshape(count, 3).astype(np.float64) * gyro_scale)
        runs = c.get("segments") or []
        if sum(int(r["count"]) for r in runs) != count:
            raise RecordingError(f"chunk {i}: segment run lengths do not sum to {count}")
        seg_parts.append(np.concatenate([np.full(int(r["count"]), int(r["segment"]), dtype=np.int64) for r in runs])
                         if runs else np.zeros(0, dtype=np.int64))
        expected_start += count

    if "sampleCount" in meta and expected_start != int(meta["sampleCount"]):
        raise RecordingError(f"chunks hold {expected_start} samples, sampleCount = {meta['sampleCount']}")
    n = expected_start
    acc = np.concatenate(acc_parts) if acc_parts else np.zeros((0, 3))
    gyro = (np.concatenate(gyro_parts) if gyro_parts else np.zeros((0, 3))) if use_gyro else None
    segment = np.concatenate(seg_parts) if seg_parts else np.zeros(0, dtype=np.int64)

    # t = position within the segment / 50 Hz. Runs of the same segment id may continue across chunks.
    t = np.zeros(n)
    run_start = 0
    for i in range(1, n + 1):
        if i == n or segment[i] != segment[i - 1]:
            t[run_start:i] = np.arange(i - run_start) / SAMPLE_RATE_HZ
            run_start = i
    return segment, t, acc, gyro


def write_recording_csv(path: str, rec_name: str, meta: dict, decoded) -> int:
    segment, t, acc, gyro = decoded
    label = str(meta.get("label", ""))
    placement = str(meta.get("placement", ""))
    if label not in CLASSES:
        raise RecordingError(f"unknown label {label!r}")
    if placement not in PLACEMENTS:
        raise RecordingError(f"unknown placement {placement!r}")
    prefix = [rec_name, label, placement, csv_safe(meta.get("platform")), csv_safe(meta.get("device"))]
    tmp = path + ".part"
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(CSV_HEADER)
        for i in range(len(t)):
            g = [f"{v:.5f}" for v in gyro[i]] if gyro is not None else ["", "", ""]
            w.writerow(prefix + [int(segment[i]), f"{t[i]:.3f}"] + [f"{v:.5f}" for v in acc[i]] + g)
    os.replace(tmp, path)  # only finished files count as "already downloaded"
    return len(t)


def _ts(v):
    """Firestore timestamp / datetime / epoch ms -> ISO string."""
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).isoformat(timespec="seconds")
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


def _as_datetime(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc)
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return None


def research_day_row(subject: str, d: dict) -> dict:
    checkin = d.get("checkin") or {}
    own = d.get("ownModel") or {}
    durations = own.get("durations") or {}
    motion = d.get("motion") or {}
    row = {"subject": subject, "dateKey": d.get("dateKey", ""), "consentVersion": d.get("consentVersion", ""),
           "updatedAt": _ts(d.get("updatedAt")), "platform": d.get("platform", ""),
           "tzOffsetMin": d.get("tzOffsetMin", ""),
           "stressLevel": "" if d.get("stressLevel") is None else d.get("stressLevel"),
           "checkin_present": int(bool(d.get("checkin")))}
    for k in CHECKIN_FIELDS:
        row[f"checkin_{k}"] = "" if checkin.get(k) is None else checkin.get(k)
    row["own_trackedSeconds"] = "" if own.get("trackedSeconds") is None else own.get("trackedSeconds")
    for k in CLASSES + sorted(set(durations) - set(CLASSES)):
        row[f"own_{k}_s"] = "" if durations.get(k) is None else durations.get(k)
    row["motion_source"] = motion.get("source", "") if d.get("motion") else ""
    for k in MOTION_TYPES:
        row[f"motion_{k}_min"] = "" if motion.get(k) is None else motion.get(k)
    row["steps"] = "" if d.get("steps") is None else d.get("steps")
    return row


def write_research_days(path: str, rows: list[dict]) -> None:
    cols: list[str] = []
    for r in rows:
        cols += [k for k in r if k not in cols]
    rows = sorted(rows, key=lambda r: (r["subject"], str(r["dateKey"])))
    tmp = path + ".part"
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols or ["subject", "dateKey"], restval="", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def read_subjects(path: str) -> dict[str, dict]:
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as fh:
        return {r["recording_id"]: r for r in csv.DictReader(fh)}


def write_subjects(path: str, rows: dict[str, dict]) -> None:
    cols = ["recording_id", "subject", "label", "placement", "platform", "device", "startedAt", "uploadedAt",
            "durationSeconds", "useGyro", "meanAccRateHz", "meanGyroRateHz", "appVersion", "stoppedBy"]
    tmp = path + ".part"
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, restval="", extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for k in sorted(rows):
            w.writerow(rows[k])
    os.replace(tmp, path)


def _stream_complete_recordings(db):
    """Collection-group query on complete == true; falls back to client-side filtering when the
    collection-group index on `complete` has not been created yet."""
    from google.api_core import exceptions as gexc
    from google.cloud.firestore_v1.base_query import FieldFilter

    try:
        q = db.collection_group("harRecordings").where(filter=FieldFilter("complete", "==", True))
        yield from q.stream()
    except gexc.FailedPrecondition as e:
        print("  note: no collection-group index on harRecordings.complete; filtering client-side.\n"
              f"        Create it once from the link in this error to speed up queries:\n        {e}")
        for snap in db.collection_group("harRecordings").stream():
            if (snap.to_dict() or {}).get("complete") is True:
                yield snap


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key", required=True, help="Firebase Admin service-account JSON (never commit it)")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"output folder (default {os.path.relpath(DEFAULT_OUT, ROOT)})")
    ap.add_argument("--since", help="only recordings uploaded and research days dated on/after YYYY-MM-DD")
    args = ap.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("firebase-admin is not installed. Install it with:\n    python -m pip install firebase-admin")

    since = None
    if args.since:
        since = datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if not os.path.exists(args.key):
        sys.exit(f"Service-account key not found: {args.key}")

    rec_dir = os.path.join(args.out, "recordings")
    os.makedirs(rec_dir, exist_ok=True)
    subjects_path = os.path.join(args.out, "subjects.csv")
    subjects = read_subjects(subjects_path)

    app = firebase_admin.initialize_app(credentials.Certificate(args.key))
    db = firestore.client(app)

    new, skipped, failed, old = 0, 0, 0, 0
    seen: set[str] = set()
    for snap in _stream_complete_recordings(db):
        meta = snap.to_dict() or {}
        uid = meta.get("uid") or snap.reference.parent.parent.id
        if int(meta.get("schemaVersion", 0)) != SUPPORTED_SCHEMA:
            print(f"  skip {snap.id}: schemaVersion {meta.get('schemaVersion')} not supported")
            failed += 1
            continue
        uploaded = _as_datetime(meta.get("uploadedAt")) or _as_datetime(meta.get("startedAt"))
        if since and uploaded and uploaded < since:
            old += 1
            continue
        subject = subject_hash(uid)
        rec_name = output_name(subject, meta.get("id") or snap.id)
        path = os.path.join(rec_dir, rec_name + ".csv")
        seen.add(rec_name)
        info = {"recording_id": rec_name, "subject": subject, "label": meta.get("label", ""),
                "placement": meta.get("placement", ""), "platform": meta.get("platform", ""),
                "device": csv_safe(meta.get("device")), "startedAt": _ts(meta.get("startedAt")),
                "uploadedAt": _ts(meta.get("uploadedAt")), "durationSeconds": meta.get("durationSeconds", ""),
                "useGyro": meta.get("useGyro", ""), "meanAccRateHz": meta.get("meanAccRateHz", ""),
                "meanGyroRateHz": meta.get("meanGyroRateHz", ""), "appVersion": meta.get("appVersion", ""),
                "stoppedBy": meta.get("stoppedBy", "")}
        if os.path.exists(path):
            subjects.setdefault(rec_name, info)
            skipped += 1
            continue
        try:
            chunks = [c.to_dict() for c in snap.reference.collection("chunks").stream()]
            n = write_recording_csv(path, rec_name, meta, decode_chunks(meta, chunks))
        except (RecordingError, KeyError, TypeError) as e:
            print(f"  skip {rec_name}: {e}")
            failed += 1
            continue
        subjects[rec_name] = info
        new += 1
        print(f"  + {rec_name} ({meta.get('label')}, {meta.get('placement')}, {n} samples)")
    removed = 0
    if since is None:
        # Full listing: drop local copies of recordings that were withdrawn (deleted) in Firestore.
        for f in os.listdir(rec_dir):
            name = f[:-4]
            if f.endswith(".csv") and SUBJECT_FILE.match(f) and name not in seen:
                os.remove(os.path.join(rec_dir, f))
                removed += 1
        subjects = {k: v for k, v in subjects.items() if k in seen}
    write_subjects(subjects_path, subjects)
    if removed:
        print(f"  removed {removed} local recording(s) no longer in Firestore (withdrawn)")
    print(f"Recordings: {new} new, {skipped} already downloaded, {failed} skipped (invalid), "
          f"{old} before --since. {len(subjects)} listed in {subjects_path}")

    rows = []
    for snap in db.collection_group("researchDays").stream():
        d = snap.to_dict() or {}
        if since and str(d.get("dateKey", snap.id)) < args.since:
            continue
        d.setdefault("dateKey", snap.id)
        rows.append(research_day_row(subject_hash(d.get("uid") or snap.reference.parent.parent.id), d))
    rd_path = os.path.join(args.out, "research_days.csv")
    if since and os.path.exists(rd_path):
        # --since only refreshes recent days; keep the older rows already on disk.
        with open(rd_path, newline="", encoding="utf-8") as fh:
            merged = {(r["subject"], r["dateKey"]): r for r in csv.DictReader(fh)}
        merged.update({(r["subject"], str(r["dateKey"])): r for r in rows})
        rows = list(merged.values())
    write_research_days(rd_path, rows)
    print(f"Research days: {len(rows)} rows from {len({r['subject'] for r in rows})} subject(s) -> {rd_path}")


if __name__ == "__main__":
    main()
