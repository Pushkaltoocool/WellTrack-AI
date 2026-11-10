# WellTrack AI — Machine Learning Report

WellTrack contains two **independent** ML components:

1. **Human activity recognition (HAR)** from smartphone accelerometer and gyroscope signals. This is the main ML contribution, and it is deployed for live on-device inference.
2. **Stress-risk classification** from lifestyle inputs. It is deployed only as an *experimental* estimate because the only suitable public dataset has rule-derived labels (§2).

The two models use unrelated datasets and are never combined. No claim is made that activity data improves stress prediction.

All numbers below were produced by the scripts in `ml/` (seed 42) and are stored in `ml/har/results/metrics.json` and `ml/stress/results/metrics.json`.

---

## 1. Human activity recognition

### 1.1 Dataset

**UCI Human Activity Recognition Using Smartphones.** D. Anguita, A. Ghio, L. Oneto, X. Parra, J. L. Reyes-Ortiz. *A Public Domain Dataset for Human Activity Recognition Using Smartphones.* ESANN 2013. <https://archive.ics.uci.edu/dataset/240/human+activity+recognition+using+smartphones> (CC BY 4.0).

- 30 volunteers aged 19–48, each wearing a Samsung Galaxy S II **on the waist**.
- 6 activities: walking, walking upstairs, walking downstairs, sitting, standing, laying.
- 50 Hz sampling, 2.56 s windows (128 samples) with 50 % overlap: **10,299 windows** in total.
- Official subject-separated split: **21 training subjects (7,352 windows)** and **9 test subjects (2,947 windows)**. The script asserts that the two subject sets are disjoint.
- Test class supports: walking 496, upstairs 471, downstairs 420, sitting 491, standing 532, laying 537.

**Why not the 561 precomputed features?** Those features come from a signal-processing pipeline (Butterworth gravity separation, FFT bands, autoregression, angle features) that would have to be reproduced exactly on the phone. Instead, the model is trained on the **raw inertial signals** (`Inertial Signals/total_acc_{x,y,z}` in g and `body_gyro_{x,y,z}` in rad/s), using a feature set that is reimplemented exactly in TypeScript.

Units and conventions were checked against the data. Upright activities have mean `total_acc_x ≈ +1 g`, which matches the Android `SensorManager` axis and sign convention. Expo Sensors on Android reports acceleration in g (values ÷ 9.81, gravity included) and the gyroscope in rad/s with sensor timestamps, so live inputs match the training units. iOS acceleration is sign-flipped in the app to match.

### 1.2 Features (82)

Each window has six channels: acc x/y/z and gyro x/y/z. Processing steps:

1. 3-point median filter per channel.
2. Derived magnitudes |a| and |ω|, giving 8 signals.
3. Per signal (9 × 8 = 72): mean, population std, min, max, median, IQR, mean absolute deviation, RMS, and std of the first difference × 50 Hz (jerk).
4. Pearson correlations: acc xy, xz, yz and gyro xy, xz, yz (6).
5. For |a| and |ω|: dominant frequency and magnitude-weighted mean frequency of the mean-removed 128-point DFT, with DC excluded (4).

The reference implementation is `ml/har/features.py`, and the port is `src/services/ml/harFeatures.ts`. The accelerometer-only fallback model uses the 41 features that don't involve the gyroscope.

### 1.3 Experimental procedure

- Hyperparameters were selected with **GroupKFold (5 folds) grouped by subject on the 21 training subjects only**, using macro-F1. Windows from one person never appear in both a training and a validation fold.
- Each tuned model was refitted on the full training split and evaluated **once** on the 9 held-out test subjects.
- Models and grids:
  - KNN (standardised; k ∈ {5, 9, 15, 25}; uniform or distance weights)
  - RBF SVM (standardised; C ∈ {1, 10, 100}; γ ∈ {scale, 0.003})
  - Decision tree (depth ∈ {6, 10, 14, None}; min leaf ∈ {1, 5, 10})
  - Random forest (100 trees; depth ∈ {12, 16, None}; min leaf ∈ {1, 3})
  - Multinomial logistic regression (standardised; C ∈ {0.1, 1, 10})

### 1.4 Results (held-out test subjects, n = 2,947 windows)

| Model | Best params | CV macro-F1 (train subjects) | Test accuracy | Test macro-F1 | Macro precision | Macro recall |
|---|---|---|---|---|---|---|
| KNN | k = 15, distance | 0.879 | 0.884 | 0.883 | 0.894 | 0.880 |
| **SVM (RBF)** | C = 100, γ = scale | **0.917** | **0.937** | **0.937** | 0.939 | 0.937 |
| Decision tree | depth 10, leaf 5 | 0.843 | 0.840 | 0.836 | 0.838 | 0.835 |
| Random forest | 100 trees, full depth | 0.899 | 0.893 | 0.892 | 0.895 | 0.890 |
| Logistic regression | C = 10 | 0.902 | 0.923 | 0.922 | 0.926 | 0.922 |

Confusion matrices for every model are in `ml/har/results/cm_*.png`.

### 1.5 Deployed model: `har-logreg-v1`

**Choice.** Multinomial logistic regression (C = 10), refitted with a standalone `StandardScaler`.

- It is 1.4 accuracy points below the RBF SVM, but 3 points *above* the random forest, and the exported JSON is only **18 KB**. Inference is a 6 × 82 matrix-vector product.
- The SVM would need its full set of support vectors (thousands × 82 values) and one-vs-one voting, and it has no native probabilities. The accuracy-versus-size trade-off favoured logistic regression.

| Metric (held-out subjects) | `har-logreg-v1` (acc + gyro) | `har-logreg-acc-v1` (acc only, fallback) |
|---|---|---|
| Accuracy | **0.9216** | 0.8660 |
| Macro-F1 | **0.9213** | 0.8655 |
| Macro precision / recall | 0.9255 / 0.9208 | 0.8678 / 0.8658 |
| Expected calibration error (10 bins) | 0.037 | 0.061 |

Per-class results for `har-logreg-v1`:

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Walking | 0.879 | 0.980 | 0.927 | 496 |
| Walking upstairs | 0.941 | 0.849 | 0.893 | 471 |
| Walking downstairs | 0.957 | 0.957 | 0.957 | 420 |
| Sitting | 0.929 | 0.821 | 0.871 | 491 |
| Standing | 0.848 | 0.940 | 0.891 | 532 |
| Laying | 1.000 | 0.978 | 0.989 | 537 |

Confusion matrix (rows are true classes, columns are predicted; order Walk, Up, Down, Sit, Stand, Lay):

```
Walk   486    0   10    0    0    0
Up      60  400    8    0    3    0
Down     6   12  402    0    0    0
Sit      0    1    0  403   87    0
Stand    1    0    0   31  500    0
Lay      0   12    0    0    0  525
```

The main errors are **sitting vs. standing** (static postures that differ mainly in device tilt) and **upstairs mislabelled as walking**. These are the classic hard pairs for this dataset.

**Probabilities.** The app shows the softmax probability of the top class. It is labelled "Model probability (softmax)", shows the held-out ECE (3.7 %), and states that it is *not calibrated for live phones or other placements*. Values ≥ 99.5 % are displayed as ">99 %", never as 100 %.

**Smoothing.** The app optionally reports the majority label over the last 3 windows (≈3.8 s) to reduce flicker. The metrics above are per-window and unsmoothed.

### 1.6 Python ↔ TypeScript parity

`tests/harParity.test.ts` uses 48 held-out windows (8 per class), with raw values rounded to 6 decimals.

- All 82 × 48 features match Python to within **1e-9 relative error**.
- Predicted classes are identical, and probabilities agree to within 1e-7, for **both** the full and accelerometer-only models.
- `tests/windower.test.ts` shows that a perfectly timed 50 Hz stream reproduces the original windows exactly. Jittered, asynchronous streams at different rates are resampled onto the exact 50 Hz grid, and gaps reset the buffer.

### 1.7 Replay demo results

The replay files contain 12 continuous clips (6 activities × test subjects 2 and 10), rebuilt from consecutive 50 %-overlapping held-out windows.

Run through the deployed model without smoothing, 101 of 129 windows (78 %) are classified correctly:

- Walking, upstairs, downstairs and standing: 59 of 60 windows correct.
- **Sitting: 2/12 correct for both subjects**, mostly predicted as standing.
- Laying for subject 10: 5/12 correct.

This is consistent with the per-subject variability behind the aggregate test figures. On the emulator, a smoothed full-tour replay for subject 2 matched the recorded label in 57 of 71 windows. Those windows include the transitions between activities.

### 1.8 Limitations and deployment differences

- **Placement shift.** Training data came from a waist-mounted phone worn sideways (gravity along +X when upright). A phone in a pocket, in the hand or upright in portrait puts gravity on a different axis. Static postures are then systematically misclassified (an upright portrait phone tends to be read as "lying down"). The app runs a live **orientation check** and warns when gravity is not along +X. Walking-type classes are less affected.
- **Device and rate shift.** Different phones have different noise, sampling jitter and delivery rates (the Android emulator delivered about 37 Hz). Live data is resampled to 50 Hz by timestamp. UCI applied a 20 Hz low-pass filter that the app does not replicate; only the 3-point median filter is shared by both pipelines.
- **Population.** 30 adults in a lab protocol. Held-out accuracy does **not** guarantee live accuracy, and no live-phone accuracy has been measured.
- **Closed set.** Running, cycling, transport and other activities are forced into one of the six classes.
- **Subject variability.** Accuracy varies between people (see §1.7).

### 1.9 Collecting labelled data from the app

Activity → *Sensor & model details* → **Collect labelled movement data** (also in Settings) records one labelled activity at a time, with the phone placement noted (waist sideways, trouser pocket, hand, bag).

- Samples go through the same `SensorWindower` as live tracking, so the recording is the exact 50 Hz resampled stream the classifier sees.
- A sensor gap starts a new `segment`. Windows never span two segments.
- The last 3 s of a manually stopped recording are dropped (taking the phone out). A countdown covers putting it away.
- Recordings stay on the phone (`har-recordings/` in the app documents folder) until exported as one CSV through the share sheet, or on Android saved to a folder you choose.
- `python -I ml/har/collected.py <export>.csv [--save windows.npz]` windows the export (128/64 per segment), extracts the same 82 features, and scores the deployed models per label and placement.
- Check: converting the 12 held-out replay clips to this CSV format reproduces the §1.7 result exactly (101/129 windows).

---

## 2. Stress-risk classification (experimental)

The full provenance analysis is in [STRESS_DATASET.md](STRESS_DATASET.md). Summary:

### 2.1 Dataset

**Student Lifestyle Dataset**, Kaggle (uploader "steve1215rogg" / Sumit Kumar), version 1, downloaded unauthenticated from `https://www.kaggle.com/api/v1/datasets/download/steve1215rogg/student-lifestyle-dataset`. The licence is declared by the uploader as Apache 2.0 and could not be verified further.

- 2,000 rows with no missing values.
- Features: study, extracurricular, sleep, social and physical-activity hours per day, plus GPA.
- Target `Stress_Level`: Low 297, Moderate 674, High 1,029.

### 2.2 Labels are rule-derived, not measured

- The dataset description says the stress level is "derived based on study and sleep hours".
- The rule **High if study > 8 or sleep < 6; else Low if study < 6; else Moderate** reproduces all 2,000 labels.
- A depth-3 decision tree on those two features reaches 100 % accuracy.
- The five hour columns sum to exactly 24 h in every row, so the data looks synthetic.

### 2.3 Method and results

The data was split into stratified train, validation and test sets (70/15/15; test n = 300). Five classifiers were compared on four feature sets, with balanced class weights where the model supports them:

| Model | all + GPA | all − GPA | app-mappable (4) | study + sleep (2) |
|---|---|---|---|---|
| Logistic regression | 0.827 / 0.827 | 0.833 / 0.837 | 0.820 / 0.817 | 0.827 / 0.825 |
| KNN | 0.897 / 0.856 | 0.913 / 0.895 | 0.930 / 0.921 | 0.990 / 0.989 |
| SVM (RBF) | 0.973 / 0.976 | 0.980 / 0.982 | 0.987 / 0.989 | 0.997 / 0.997 |
| Decision tree | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 |
| Random forest | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 |

Values are test accuracy / macro-F1. Logistic regression plateaus around 0.83 because the High region (study > 8 **or** sleep < 6) is not linearly separable from the others.

### 2.4 Deployed: `stress-v1`

- Decision tree, depth 3, inputs **study hours and sleep hours**, copied from the check-in without transformation.
- It reproduces the labelling rule, with thresholds at 5.95 h and 8.05 h.
- Python and TypeScript parity is verified on 20 fixtures, comparing thresholds in float32 as scikit-learn does.

How the app presents it:

- The estimate is labelled **Experimental** and *"Category from the dataset's labelling"*.
- **No confidence is shown**, because every leaf is pure (0 % or 100 %).
- The user's own stress rating is shown first and separately.
- The app lists the exact inputs and the decision path, and warns when inputs fall outside the 5–10 h training range.
- It states explicitly that the 100 % test score reflects the rule-based labels, not real-world validity.

### 2.5 Limitations

- The estimate has never been validated against any measured or self-reported stress outcome.
- The thresholds are not clinical.
- Self-reported stress, mood, pressure, screen, social and activity inputs do not affect the estimate.
- The provenance of the population is unverified.

**Recommended next step:** collect consented in-app check-ins and use self-reported stress as the label to train a genuinely predictive model.

---

## 3. Improving the activity model with users' recordings

The app's label set has seven activities: walking, **running**, upstairs, downstairs, sitting, standing and lying down. The app shows lying down as "Sleeping / lying down", and users record it in bed. UCI has no running data, so the shipped model only predicts running once enough people have recorded it. The steps below are the whole loop. Run every command from the repository root.

**1. Collect.** Users who opt in record labelled activities in the app. Finished recordings upload to Firestore under `users/{uid}/harRecordings` (int16 chunks), and daily summaries go to `users/{uid}/researchDays`. Nothing is needed on your side.

**2. Fetch.**

```bash
python -m pip install firebase-admin          # once
python -I ml/har/fetch_firestore.py --key welltrackai-128b4-firebase-adminsdk-fbsvc-6c75efe737.json
```

- This writes one CSV per finished recording to `data/collected/firestore/recordings/`, plus `subjects.csv` (recording → subject) and `research_days.csv` (one flat row per user-day).
- Users are identified only by a short salted hash of their uid (for example `s1a2b3c4d5e`), never by the uid itself.
- Runs are incremental: recordings already on disk are skipped. `--since YYYY-MM-DD` limits a run to recent uploads.
- A run **without** `--since` also deletes local copies of recordings that users withdrew. Run it that way regularly so withdrawals are respected.
- `data/collected/` and the service-account key are git-ignored. Never commit either.
- Optionally, create the collection-group index on `harRecordings.complete` from the link the script prints. Without it the script still works and filters on your side.

**3. Check (optional).** `python -I ml/har/collected.py data/collected` shows how the **currently shipped** model scores on real phones, per activity and placement.

**4. Train.**

```bash
python -I ml/har/train_har.py                     # UCI + everything in data/collected/
python -I ml/har/train_har.py --collected-only    # only app recordings (UCI is waist-mounted; users mostly use pockets)
```

- The script prints a table of subjects and windows per class, for UCI and for collected data.
- A class is exported only with **at least 3 different people and 200 windows** (2.56 s each, about 4.3 min). Change this with `--min-subjects` and `--min-windows`. Excluded classes are listed with the reason, together with what the model predicts for their windows instead (e.g. running → walking).
- About 30 % of the collected users are held out for testing (`--collected-test-frac`). The metrics are split by source (UCI vs. collected) and by placement. **The collected/placement numbers are the ones that predict real-phone accuracy.**
- Useful options:
  - `--lr-only` skips the slow comparison models.
  - `--balanced` evens out rare classes.
  - `--collected-weight 3` makes app windows count more than UCI windows.
  - `--refit-all` retrains on the held-out users too, after evaluation.
  - `--model-version v3` sets the version suffix of the model IDs; use a new suffix for every release.
- With no collected data, the script reproduces the UCI-only six-class model (§1).

The outputs go to `ml/har/build/` (git-ignored):

| File | Purpose |
|---|---|
| `har_model.json`, `har_model_acc.json` | Models with acc + gyro and accelerometer only |
| `har_fixtures.json` | Parity fixtures |
| `metrics.json`, `class_counts.csv` | Metrics and per-class data counts |
| `cm_*.png` | Confusion matrices |

**5. Ship.**

1. Copy `ml/har/build/har_model.json` and `har_model_acc.json` to `models/`.
2. Copy `har_fixtures.json` to `tests/fixtures/`.
3. Optionally, copy `metrics.json` and the PNGs to `ml/har/results/`.
4. Update `tests/harParity.test.ts`: the expected model ID, and the expected number of fixture classes if it changed.
5. Run the checks: `npx jest tests/harParity`, `npx tsc --noEmit` and `npx expo lint`.
6. Rebuild the app.

The app reads the class list from each model file, so a model with fewer or more classes needs no code change. The features (`features.py` ↔ `harFeatures.ts`) must stay unchanged.
