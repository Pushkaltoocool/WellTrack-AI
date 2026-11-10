"""
Synthetic round-trip test for ml/har/fetch_firestore.py (no Firebase needed).

    python -I ml/har/test_firestore_codec.py

A small encoder (struct-based, independent of the numpy decoder) mirrors the Firestore layout the app
uploads: int16 little-endian, interleaved x,y,z, `segments` run-length encoding per chunk, chunks that
split segments and segments that span chunks. Checks:
    decode(encode(x)) == x within 1 LSB (acc 1/4096 g, gyro 1/1000 rad/s)
    the written CSV is read back by ml/har/collected.py with the same values, segments, subjects and
    windows (128/64 within segments only), and t restarts at 0 in every segment.
"""
from __future__ import annotations

import os
import shutil
import struct
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collected  # noqa: E402
import fetch_firestore as ff  # noqa: E402

ACC_SCALE = 1 / 4096
GYRO_SCALE = 1 / 1000


def _pack(values: np.ndarray, scale: float) -> bytes:
    ints = [max(-32768, min(32767, int(round(v / scale)))) for v in values.reshape(-1)]
    return struct.pack(f"<{len(ints)}h", *ints)


def encode(meta: dict, segment: np.ndarray, acc: np.ndarray, gyro: np.ndarray | None, chunk_size: int):
    """Mirror of the app uploader: returns (recording doc, chunk docs)."""
    n = len(segment)
    chunks = []
    for index, start in enumerate(range(0, n, chunk_size)):
        sl = slice(start, min(n, start + chunk_size))
        runs = []
        for s in segment[sl]:
            if runs and runs[-1]["segment"] == int(s):
                runs[-1]["count"] += 1
            else:
                runs.append({"segment": int(s), "count": 1})
        chunks.append({"index": index, "start": start, "count": sl.stop - start, "acc": _pack(acc[sl], ACC_SCALE),
                       "gyro": _pack(gyro[sl], GYRO_SCALE) if gyro is not None else None, "segments": runs})
    doc = dict(meta, uid="test-uid-123", schemaVersion=1, consentVersion=1, complete=True, sampleRateHz=50,
               chunkCount=len(chunks), encoding="int16le", accScale=ACC_SCALE, gyroScale=GYRO_SCALE,
               sampleCount=n, segments=len(set(segment.tolist())), useGyro=gyro is not None)
    return doc, chunks


def synthetic(seed: int, seg_lengths: list[int], gyro: bool):
    rng = np.random.default_rng(seed)
    segment = np.concatenate([np.full(L, s) for s, L in enumerate(seg_lengths)])
    n = len(segment)
    tt = np.arange(n) / 50
    acc = np.stack([np.sin(2 * np.pi * 1.8 * tt) * 1.5 + 0.98, rng.normal(0, 0.4, n), rng.uniform(-7.9, 7.9, n)], axis=1)
    g = np.stack([rng.uniform(-30, 30, n), np.cos(tt), rng.normal(0, 2, n)], axis=1) if gyro else None
    return segment, acc, g


def check(label, placement, seg_lengths, gyro, chunk_size, out_dir, seed):
    segment, acc, g = synthetic(seed, seg_lengths, gyro)
    meta = {"id": f"20261110-0900{seed:02d}-{label.lower().replace('_', '')}-{placement}", "label": label,
            "placement": placement, "platform": "android", "device": "Pixel 7, test", "startedAt": 1762765200000}
    doc, chunks = encode(meta, segment, acc, g, chunk_size)
    rng = np.random.default_rng(seed)
    shuffled = [chunks[i] for i in rng.permutation(len(chunks))]  # Firestore order is not guaranteed

    seg_d, t_d, acc_d, gyro_d = ff.decode_chunks(doc, shuffled)
    assert np.array_equal(seg_d, segment)
    err_acc = np.max(np.abs(acc_d - acc)) / ACC_SCALE
    assert err_acc <= 1.0, err_acc
    err_gyro = 0.0
    if gyro:
        err_gyro = np.max(np.abs(gyro_d - g)) / GYRO_SCALE
        assert err_gyro <= 1.0, err_gyro
    else:
        assert gyro_d is None
    for s, L in enumerate(seg_lengths):  # t restarts in every segment
        assert np.allclose(t_d[segment == s], np.arange(L) / 50)

    subject = ff.subject_hash(doc["uid"])
    name = ff.output_name(subject, meta["id"])
    path = os.path.join(out_dir, "recordings", name + ".csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ff.write_recording_csv(path, name, doc, (seg_d, t_d, acc_d, gyro_d))

    segs = collected.load_rows([path])
    assert sorted(segs) == [(name, s) for s in range(len(seg_lengths))]
    back = np.concatenate([np.asarray(segs[(name, s)]["samples"]) for s in range(len(seg_lengths))])
    assert np.max(np.abs(back[:, :3] - acc)) / ACC_SCALE <= 1.0
    if gyro:
        assert np.max(np.abs(back[:, 3:] - g)) / GYRO_SCALE <= 1.0
    assert all(s["gyro"] == gyro and s["label"] == label and s["device"] == "Pixel 7 test" for s in segs.values())
    X, y, wmeta = collected.to_windows(segs)
    expect = sum(max(0, (L - 128) // 64 + 1) for L in seg_lengths)
    assert len(X) == expect, (len(X), expect)
    assert {m["subject"] for m in collected.to_windows(segs, {})[2]} == {subject}  # parsed from the prefix
    print(f"  {label:<20} gyro={gyro!s:<5} {len(segment):>5} samples in {len(chunks)} chunks, "
          f"{len(seg_lengths)} segments: max error acc {err_acc:.3f} LSB, gyro {err_gyro:.3f} LSB; {len(X)} windows")
    return name, subject


def main():
    tmp = tempfile.mkdtemp(prefix="har_codec_")
    try:
        print("decode(encode(x)) round trip:")
        subjects = {}
        for i, (label, placement, segs, gyro, cs) in enumerate([
            ("WALKING", "pocket", [700, 130, 2100], True, 1000),   # segment spans chunk boundaries
            ("RUNNING", "hand", [127, 129, 500], True, 64),        # many small chunks, too-short segment
            ("LAYING", "bag", [1500], False, 512),                 # no gyroscope
        ]):
            name, subj = check(label, placement, segs, gyro, cs, tmp, seed=i + 1)
            subjects[name] = {"recording_id": name, "subject": subj}
        ff.write_subjects(os.path.join(tmp, "subjects.csv"), subjects)
        ff.write_research_days(os.path.join(tmp, "research_days.csv"), [ff.research_day_row("sabc", {
            "dateKey": "2026-11-10", "stressLevel": 3, "checkin": {"sleepHours": 7}, "ownModel": {
                "trackedSeconds": 60, "durations": {"WALKING": 60}}, "motion": None, "steps": 1200})])

        # Integrity errors are detected, not silently written.
        segment, acc, g = synthetic(9, [300], True)
        doc, chunks = encode({"id": "x", "label": "WALKING", "placement": "pocket"}, segment, acc, g, 100)
        for broken in (chunks[:-1], [dict(chunks[0], count=99)] + chunks[1:], [dict(c, gyro=None) for c in chunks]):
            try:
                ff.decode_chunks(doc, broken)
                raise AssertionError("corrupt recording accepted")
            except ff.RecordingError:
                pass

        X, y, F, meta, n_files = collected.load_collected([tmp], verbose=False)
        assert n_files == 3, n_files  # subjects.csv / research_days.csv are skipped by header
        assert {m["subject"] for m in meta} == {ff.subject_hash("test-uid-123")}
        assert F.shape == (len(X), 82) and np.all(np.isfinite(F))
        print(f"collected.load_collected: {n_files} recording files, {len(X)} windows, labels "
              f"{sorted({collected.CLASSES[v] for v in y})}")
        print("All codec checks passed.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
