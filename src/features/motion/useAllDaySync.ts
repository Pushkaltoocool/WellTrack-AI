/**
 * Runs on launch and whenever the app returns to the foreground (at most every few minutes):
 * pulls the OS motion history, classifies Android background chunks, and — with research consent —
 * uploads pending recordings and recent daily rows. Failures are logged and retried next time.
 */
import { useEffect, useEffectEvent, useRef } from 'react';
import { AppState } from 'react-native';

import { syncPendingRecordings } from '@/features/research/researchUpload';
import { refreshCrewWidget } from '@/features/widgets/widgetSync';
import { syncResearchDays } from '@/features/research/dailyFeatures';
import { useAccount } from '@/services/cloud/AccountProvider';
import { useData } from '@/services/database/DataProvider';

import { backgroundModelRunning, backgroundModelSupported, processBackgroundChunks, setBackgroundModel, syncMotionHistory } from './motionSync';

const MIN_INTERVAL_MS = 5 * 60_000;

export function useAllDaySync() {
  const { db, prefs, invalidate } = useData();
  const { user } = useAccount();
  const last = useRef(0);
  const running = useRef(false);

  const run = useEffectEvent(async (force: boolean) => {
    if (running.current || (!force && Date.now() - last.current < MIN_INTERVAL_MS)) return;
    running.current = true;
    last.current = Date.now();
    let changed = false;
    const step = async (name: string, fn: () => Promise<number>) => {
      try {
        changed = (await fn()) > 0 || changed;
      } catch (e) {
        console.warn(`[all-day:${name}]`, e);
      }
    };
    try {
      await step('widget', async () => {
        await refreshCrewWidget();
        return 0;
      });
      if (prefs.allDayActivity) await step('motion', () => syncMotionHistory(db));
      if (backgroundModelSupported()) {
        await step('background', () => processBackgroundChunks(db));
        // The service can be killed (force-stop, OEM battery savers); bring it back if it should run.
        if (prefs.backgroundModel && !backgroundModelRunning()) await step('restart', async () => {
          await setBackgroundModel(true);
          return 0;
        });
      }
      if (user && prefs.researchRecordingsConsentAt) await step('recordings', () => syncPendingRecordings(user.uid));
      if (user && prefs.researchDailyConsentAt) await step('days', () => syncResearchDays(db, user.uid));
    } finally {
      running.current = false;
      if (changed) invalidate();
    }
  });

  const uid = user?.uid;
  useEffect(() => {
    void run(true);
  }, [uid, prefs.allDayActivity, prefs.backgroundModel, prefs.researchDailyConsentAt, prefs.researchRecordingsConsentAt]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run(false);
    });
    return () => sub.remove();
  }, []);
}
