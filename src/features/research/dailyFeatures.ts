/**
 * One row per day pairing the user's own stress rating (the label) with passively measured
 * activity. Used on-device for Trends correlations, and uploaded to users/{uid}/researchDays
 * only with research consent, so a stress model can be trained on real data later.
 */
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { addDays, todayKey } from '@/lib/dates';
import type { Db } from '@/services/database/db';
import { listBackgroundDays, listMotionDays, type MotionMinutes } from '@/services/database/motionRepo';
import { listCheckIns, listDailySteps, listSessions } from '@/services/database/repositories';
import { firestore } from '@/services/firebase/app';
import { ACTIVE_CLASSES, emptyDurations, HAR_CLASSES, type ActivityDurations, type CheckIn } from '@/types/domain';

import { CONSENT_VERSION } from './researchUpload';

export interface DayFeatures {
  dateKey: string;
  stressLevel: number | null;
  mood: number | null;
  checkin: Omit<CheckIn, 'id' | 'dateKey' | 'notes' | 'createdAt' | 'updatedAt' | 'stressLevel' | 'mood'> | null;
  /** Our model: live sessions plus (Android) background estimates, seconds per class. */
  ownModel: { trackedSeconds: number; durations: ActivityDurations } | null;
  /** OS motion history, minutes per type. */
  motion: (MotionMinutes & { source: string }) | null;
  steps: number | null;
  /** Best measured estimate of active minutes (walking + running + stairs), or null if nothing measured. */
  activeMinutes: number | null;
}

export async function buildDayFeatures(db: Db, days: number): Promise<DayFeatures[]> {
  const to = todayKey();
  const from = addDays(to, -(days - 1));
  const [checkins, sessions, motion, background, steps] = await Promise.all([
    listCheckIns(db, from, to),
    listSessions(db, { source: 'live', fromKey: from }),
    listMotionDays(db, from, to),
    listBackgroundDays(db, from, to),
    listDailySteps(db, from, to),
  ]);
  const out: DayFeatures[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) {
    const c = checkins.find((x) => x.dateKey === key) ?? null;
    const m = motion.find((x) => x.dateKey === key) ?? null;
    const bg = background.find((x) => x.dateKey === key) ?? null;
    const durations = emptyDurations();
    let hasModel = false;
    for (const s of sessions.filter((x) => x.dateKey === key)) {
      hasModel = true;
      for (const k of HAR_CLASSES) durations[k] += s.durations[k] ?? 0;
    }
    if (bg) {
      hasModel = true;
      for (const k of HAR_CLASSES) durations[k] += bg.durations[k] ?? 0;
    }
    const tracked = HAR_CLASSES.reduce((a, k) => a + durations[k], 0);
    const modelActive = hasModel ? ACTIVE_CLASSES.reduce((a, k) => a + durations[k], 0) / 60 : null;
    const motionActive = m ? m.minutes.walking + m.minutes.running : null;
    const activeMinutes = modelActive === null && motionActive === null ? null : Math.round(Math.max(modelActive ?? 0, motionActive ?? 0));
    const st = steps.find((x) => x.dateKey === key);
    out.push({
      dateKey: key,
      stressLevel: c?.stressLevel ?? null,
      mood: c?.mood ?? null,
      checkin: c
        ? {
            sleepHours: c.sleepHours,
            studyHours: c.studyHours,
            academicPressure: c.academicPressure,
            screenTimeHours: c.screenTimeHours,
            physicalActivityMinutes: c.physicalActivityMinutes,
            socialHours: c.socialHours,
            extracurricularHours: c.extracurricularHours,
          }
        : null,
      ownModel: hasModel ? { trackedSeconds: Math.round(tracked), durations } : null,
      motion: m ? { ...m.minutes, source: m.source } : null,
      steps: st?.steps ?? null,
      activeMinutes,
    });
  }
  return out;
}

/** Uploads the last `days` days that have anything measured or rated. Journal text is never included. */
export async function syncResearchDays(db: Db, uid: string, days = 14): Promise<number> {
  const rows = (await buildDayFeatures(db, days)).filter((d) => d.stressLevel !== null || d.ownModel || d.motion || d.steps !== null);
  const tzOffsetMin = -new Date().getTimezoneOffset();
  for (const d of rows) {
    const { activeMinutes: _derived, ...data } = d;
    await setDoc(doc(firestore(), 'users', uid, 'researchDays', d.dateKey), {
      ...data,
      uid,
      consentVersion: CONSENT_VERSION,
      updatedAt: serverTimestamp(),
      platform: Platform.OS,
      tzOffsetMin,
    });
  }
  return rows.length;
}
