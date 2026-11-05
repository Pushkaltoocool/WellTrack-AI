# Stress-risk classifier: dataset, method and results

This is the stress-risk component of WellTrack AI. It was built as a supervised classification
experiment for an Intro to ML report. All numbers below come from `ml/stress/train_stress.py`
(seed 42) and are saved in `ml/stress/results/metrics.json`.

**Main finding.** The labels in the public dataset were produced by a simple rule applied to
two of the inputs, and the data itself looks synthetic. Any model trained on it can only learn
that rule again. The deployed model therefore reaches 100% test accuracy, but that number says
nothing about how well it would detect real student stress. The limitations at the end of this
document must be shown in the app.

---

## 1. Dataset identity and provenance

| Item | Value |
|---|---|
| Name | "student lifestyle dataset": *Daily Lifestyle and Academic Performance of Students* |
| Author / owner | Sumit Kumar (Kaggle user `steve1215rogg`) |
| Dataset page | https://www.kaggle.com/datasets/steve1215rogg/student-lifestyle-dataset |
| Download URL used | `https://www.kaggle.com/api/v1/datasets/download/steve1215rogg/student-lifestyle-dataset` (unauthenticated; HTTP 200, redirected to a signed Google Cloud Storage `archive.zip`) |
| Version | 1 ("Initial release", 2024-11-11T19:11:28Z), the only version |
| Downloaded | 2026-10-29 (UTC) |
| Archive | `data/stress/raw/student_lifestyle.zip`, 22,153 bytes, SHA-256 `9dab12e19544dd2dc96db904d401fc13effb07782730accb3795d2a1f2c451eb` |
| File | `student_lifestyle_dataset.csv`, 71,205 bytes, SHA-256 `bcd254faeb556358d85b29f086e2ed7428aee368e80c89bc579db4f8015185d9` |
| Metadata snapshots | `data/stress/raw/kaggle_view.json`, `data/stress/raw/kaggle_metadata.json` (Kaggle API `datasets/view` and `datasets/metadata`) |

The file came straight from Kaggle, not from a mirror. Its size (71,205 bytes) matches the
`totalBytes` value in the Kaggle metadata. The download was treated as untrusted data: it was
unpacked with a path-checked `zipfile` routine, read only with pandas, and all Python was run
with `-I`.

### Licence

The Kaggle metadata gives the licence as **Apache 2.0** (`"licenseName":"Apache 2.0"`,
`"licenses":[{"name":"apache-2.0"}]`). Apache 2.0 is a permissive licence. It allows use,
modification and redistribution, including commercial use, as long as the licence and
attribution notices are kept. **Caveat:** this licence was declared by the uploader. We cannot
check whether the uploader had the right to license the data, and Apache 2.0 is a software
licence that is being applied to data here. Attribution: *"student lifestyle dataset" by Sumit
Kumar (steve1215rogg), Kaggle, Apache 2.0.*

### Author's description (quoted from Kaggle metadata)

> "This dataset provides a detailed view of student lifestyle patterns and their correlation with
> academic performance, represented by GPA. It contains 2,000 records of students' daily habits
> across study, extracurriculars, sleep, socializing, and physical activities. **Each student's
> stress level is derived based on study and sleep hours**, offering insights into how lifestyle
> factors may impact academic outcomes."

> Sources field: "The data was self-reported by students who participated in the survey through
> Google Forms. The form was shared with students across different educational institutions,
> primarily focusing on those in India and other South Asian countries, where the CGPA system is
> widely used."

---

## 2. Data profile

* **Samples:** 2,000 rows, 8 columns. **Missing values:** none. **Duplicate rows** (ignoring the ID): none.
  `Student_ID` runs 1 to 2000 in order.

| Column | Unit | Observed range | Mean | Notes |
|---|---|---|---|---|
| `Student_ID` | — | 1–2000 | — | identifier, not used |
| `Study_Hours_Per_Day` | hours/day | 5.0–10.0 | 7.48 | 0.1 h resolution, roughly uniform |
| `Extracurricular_Hours_Per_Day` | hours/day | 0.0–4.0 | 1.99 | roughly uniform |
| `Sleep_Hours_Per_Day` | hours/day | 5.0–10.0 | 7.50 | roughly uniform |
| `Social_Hours_Per_Day` | hours/day | 0.0–6.0 | 2.70 | |
| `Physical_Activity_Hours_Per_Day` | hours/day | 0.0–13.0 | 4.33 | **exactly 24 minus the other four** (see §3) |
| `GPA` | 0–4 scale | 2.24–4.00 | 3.12 | correlated with study hours (r = 0.73) |
| `Stress_Level` (target) | category | Low / Moderate / High | — | |

**Class distribution (moderately imbalanced):**

| Class | Count | Share |
|---|---|---|
| Low | 297 | 14.9% |
| Moderate | 674 | 33.7% |
| High | 1,029 | 51.5% |

---

## 3. Label-provenance analysis: are the labels real?

**Conclusion: the labels are rule-derived, and the feature rows look synthetic.** The evidence:

1. **The author says so.** The description states that the stress level "is derived based on
   study and sleep hours". The label was not measured or self-reported.
2. **A depth-3 decision tree on two features gets 100% accuracy.** In 5-fold stratified CV over
   all 2,000 rows, a tree using only `Study_Hours_Per_Day` and `Sleep_Hours_Per_Day` scores
   0.720 at depth 1, 0.854 at depth 2 and **1.000 at depth 3**. Adding the other four features
   (including GPA) changes nothing. Study alone reaches 0.869 and sleep alone 0.53.
3. **We recovered the exact rule.** Reading it off that tree gives:

   ```
   High      if Study > 8.0 h  or  Sleep < 6.0 h
   Low       else if Study < 6.0 h
   Moderate  otherwise
   ```

   This rule matches **2000 / 2000 labels (0 mismatches)**.
4. **The feature rows look generated, not surveyed.** In every one of the 2,000 rows, study,
   extracurricular, sleep, social and physical-activity hours add up to exactly 24.0 h (largest
   deviation 3.6e-15, which is floating-point rounding). `Physical_Activity_Hours_Per_Day`
   equals 24 minus the other four columns exactly. This is why it reaches an implausible
   13 h/day and averages 4.3 h/day. Study, sleep and extracurricular hours are close to uniform
   between their bounds, which is unusual for real survey answers. Self-reported Google Forms
   data would not add up to exactly 24 h in every row.

So the "Google Forms" claim conflicts with points 1 and 4. We think it most likely that the rows
were generated (or heavily processed) and the label was then computed by the rule above. Either
way, **the target is a deterministic function of two inputs. It is not a measurement of
stress.**

---

## 4. Mapping dataset features to app inputs

The app check-in collects sleep hours, study hours, academic pressure (1–5), screen time (h),
physical activity (min), social activity (h), self-reported stress (1–5) and mood (1–5).
A dataset column was allowed only if it is in the dataset **and** maps to an app field with the
same units:

| Dataset column | App field | Transform | Allowed? |
|---|---|---|---|
| `Study_Hours_Per_Day` | `studyHours` | none (h/day) | yes |
| `Sleep_Hours_Per_Day` | `sleepHours` | none (h/day) | yes |
| `Social_Hours_Per_Day` | `socialActivityHours` | none (h/day) | yes |
| `Physical_Activity_Hours_Per_Day` | `physicalActivityMinutes` | ÷ 60 | units match, but semantically doubtful: in this dataset it is the "remaining hours of the day" |
| `Extracurricular_Hours_Per_Day` | — | — | **no**, the app does not collect it |
| `GPA` | — | — | **no**, the app does not collect it |
| — | academic pressure, screen time, self-reported stress, mood | — | not in dataset, so cannot be used |

---

## 5. Methodology

* **Split:** stratified 70 / 15 / 15 (train 1,400 / validation 300 / test 300) with
  `random_state=42`. Hyper-parameters were tuned on the validation set only. The test set was
  used only to report the final metrics of each tuned model.
* **Models:** Logistic Regression (multinomial, StandardScaler), KNN (StandardScaler), SVM (RBF,
  StandardScaler), Decision Tree, Random Forest (≤ 50 trees). Scalers were fit on the training
  split only, inside a `Pipeline`.
* **Grids:** LR C ∈ {0.01, 0.1, 1, 10, 100}; KNN k ∈ {3, 5, 9, 15, 25} × {uniform, distance};
  SVM C ∈ {0.1, 1, 10, 100}; DT max_depth ∈ {2, 3, 4, 6, None} × min_samples_leaf ∈ {1, 5};
  RF n_estimators ∈ {25, 50} × max_depth ∈ {3, 5, 8, None}.
* **Class imbalance:** `class_weight="balanced"` for LR, SVM, DT and RF. KNN has no class-weight
  option, so it was left unweighted (this is noted in the results). Model selection used
  **macro-F1**, which weights all three classes equally.
* **Feature sets compared:** `all_with_gpa` (6), `all_without_gpa` (5, includes
  extracurricular), `app_mappable` (study, sleep, social, physical activity) and
  `app_study_sleep` (study, sleep).
* **Deployment rule (fixed before looking at test results):** consider only deployable model
  types (decision tree, logistic regression, random forest) on app-mappable feature sets. Find
  the best validation macro-F1. Among candidates within 0.01 of it, take the one with the fewest
  features, then the simplest model (tree < LR < forest).

---

## 6. Results (test set, n = 300)

Accuracy / macro-F1 on the held-out test set. Validation scores and per-class
precision/recall/F1 for every cell are in `ml/stress/results/metrics.json`. Confusion
matrices are in `ml/stress/results/cm_<featureSet>_<model>.png`.

| Model | all_with_gpa | all_without_gpa | app_mappable | app_study_sleep |
|---|---|---|---|---|
| Logistic Regression | 0.827 / 0.827 | 0.833 / 0.837 | 0.820 / 0.817 | 0.827 / 0.825 |
| KNN | 0.897 / 0.856 | 0.913 / 0.895 | 0.930 / 0.921 | 0.990 / 0.989 |
| SVM (RBF) | 0.973 / 0.976 | 0.980 / 0.982 | 0.987 / 0.989 | 0.997 / 0.997 |
| Decision Tree | **1.000 / 1.000** | **1.000 / 1.000** | **1.000 / 1.000** | **1.000 / 1.000** |
| Random Forest | **1.000 / 1.000** | **1.000 / 1.000** | **1.000 / 1.000** | **1.000 / 1.000** |
| *Reference: hand-written rule (§3)* | — | — | — | *1.000 / 1.000* |

How to read this table:

* **With and without GPA.** Removing GPA does not hurt any model. LR goes from 0.827 to 0.837
  macro-F1 and KNN from 0.856 to 0.895. GPA carries no information about the label beyond study
  hours, because the label never used GPA.
* **Trees win because the label is made of threshold rules.** Axis-aligned splits can express
  the rule exactly at depth 3. **Logistic regression** cannot: the High region (`study > 8 OR
  sleep < 6`) is not linearly separable from the others, so LR plateaus at about 0.83.
  **KNN and SVM** get better when the irrelevant features are removed (app_study_sleep), because
  those features add noise to the distance and kernel calculations.
* **Extra features add nothing.** Social and physical-activity hours do not improve the tree
  (both feature sets score 1.000). This agrees with §3.

---

## 7. Deployed model

| Item | Value |
|---|---|
| File | `models/stress_model.json` (about 6 KB) |
| Type | `decision_tree`, max_depth = 3, class_weight = balanced, 9 nodes / 5 leaves |
| `featureNames` | `["Study_Hours_Per_Day", "Sleep_Hours_Per_Day"]` |
| `appInputMapping` | Study: `studyHours` (h/day, no transform). Sleep: `sleepHours` (h/day, no transform) |
| `featureRanges` (train) | study [5, 10], sleep [5, 10] |
| `scaler` | `null` (trees need no scaling) |
| Validation | accuracy 1.000, macro-F1 1.000 |
| Test | accuracy 1.000, macro-F1 1.000; confusion matrix [[45,0,0],[0,101,0],[0,0,154]] (rows true Low/Moderate/High) |

**Why this model.** It is the simplest candidate that ties for the best validation macro-F1. It
needs only two inputs, and anyone can audit it: the learned tree is the §3 rule, with split
thresholds at 5.95 h (study, sleep) and 8.05 h (study). A logistic regression would have been
easier to describe as "a weighted sum", but it scores about 17 points lower in macro-F1, which
is far outside the 1-point tolerance.

**Implementation notes for the TypeScript port.**

* Class order is `["Low","Moderate","High"]`. Leaf `value` vectors are class-probability
  distributions in that order. Every leaf is pure, so the probabilities are always 0 or 1.
  **Do not present them as calibrated confidence.**
* Leaves have `feature = -2`, `threshold = -2`, `left = right = -1`. The test at each internal
  node is `x[feature] <= threshold`, which sends the input left.
* Thresholds are sklearn float32 values (e.g. `5.950000047683716`). sklearn casts inputs to
  float32 before comparing, so `Math.fround(x) <= threshold` gives bit-exact parity. Plain
  float64 comparison only differs for inputs within about 1e-7 of a threshold.
* `ml/stress/fixtures.json` contains 20 test rows (7 Low, 7 Moderate, 6 High). Each row has its
  raw features, the sklearn `predictedClass` and the `predict_proba` output. A Python traversal
  of the exported JSON reproduces all 20 exactly.

---

## 8. Limitations (must be communicated)

1. **Rule-derived labels.** The model is a learned copy of "High if study > 8 h or sleep < 6 h;
   Low if study < 6 h; otherwise Moderate". It has never been compared against any measured or
   self-reported stress outcome, so **its real-world validity is unknown**.
2. **100% accuracy is an artefact.** The score is perfect only because the target was computed
   from the inputs. It must not be reported as evidence that the app detects stress.
3. **Synthetic-looking data.** The activity hours add up to exactly 24 h in every row, and
   physical activity is a residual. The claimed Google Forms survey of South Asian students
   cannot be verified and conflicts with these properties.
4. **Narrow input range.** The training data covers study and sleep from 5 to 10 h/day only.
   Outside that range the tree extrapolates flatly: any study time under 6 h with at least 6 h
   of sleep is "Low", and any sleep under 6 h is "High". The app should flag inputs outside
   `featureRanges`.
5. **Ignores most check-in data.** Social activity, physical activity, academic pressure,
   screen time, self-reported stress and mood do not affect the output. Self-reported stress
   is the user's own direct measure and should be shown alongside the model output, not
   replaced by it.
6. **Hard thresholds.** A change of 0.1 h can flip the category (for example, 8.0 h of study
   is Moderate and 8.1 h is High).
7. **Not a medical tool.** The output is an indicative "stress-risk" category for reflection
   only. It is not a diagnosis.

### Alternatives considered

* `rxnach/student-stress-factors-a-comprehensive-analysis` (Kaggle, Apache 2.0). Its about 20
  features are survey ratings (anxiety level, sleep quality, study load, bullying, …), not
  hours. They cannot be mapped to the app's check-in fields with matching units. We read its
  metadata but did not download it.
* We did not find a public, properly licensed dataset that has *measured or validated* stress
  labels and also uses hour-based lifestyle inputs. Collecting the app's own check-ins, with
  self-reported stress as the label and user consent, would be the honest way to build a
  better model.

---

## 9. Reproducing

```bash
# from the repository root; data/stress/raw/extracted/student_lifestyle_dataset.csv must exist
python -I ml/stress/train_stress.py
```

Tested with Python 3.13, scikit-learn 1.6.1, numpy 2.4, pandas 2.2 and matplotlib 3.10.
Apart from the `trainedAt` timestamp, two runs produce identical outputs.
