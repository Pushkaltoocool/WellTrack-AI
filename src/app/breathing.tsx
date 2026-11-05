import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Owl } from '@/components/ui/Owl';
import { Screen } from '@/components/ui/Screen';
import { SuggestionCompletion } from '@/components/wellness/SuggestionCompletion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useData } from '@/services/database/DataProvider';
import { logPractice } from '@/services/database/repositories';
import { useStyles } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

const PHASE_SECONDS = 4;
const PHASES = [{ label: 'Breathe in', to: 1 }, { label: 'Hold', to: 1 }, { label: 'Breathe out', to: 0 }, { label: 'Hold', to: 0 }];
const ROUND_SECONDS = 16;
const TOTAL_ROUNDS = 8;
const TOTAL_SECONDS = ROUND_SECONDS * TOTAL_ROUNDS;
export default function Breathing() {
  const styles = useStyles(makeStyles);
  const reducedMotion = useReducedMotion();
  const { db, invalidate } = useData();
  const record = (seconds: number) => { void logPractice(db, 'breathing', seconds).then(invalidate).catch(() => undefined); };
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [scale] = useState(() => new Animated.Value(0));
  const phaseIndex = Math.floor(elapsed / PHASE_SECONDS) % PHASES.length;
  const round = Math.min(TOTAL_ROUNDS, Math.floor(elapsed / ROUND_SECONDS) + 1);
  const count = PHASE_SECONDS - (elapsed % PHASE_SECONDS);
  const done = !running && elapsed >= TOTAL_SECONDS;
  useEffect(() => {
    if (!running) return;
    const started = Date.now() - elapsed * 1000;
    const id = setInterval(() => {
      const seconds = Math.min(TOTAL_SECONDS, Math.floor((Date.now() - started) / 1000));
      setElapsed(seconds);
      if (seconds >= TOTAL_SECONDS) { setRunning(false); record(seconds); }
    }, 250);
    return () => clearInterval(id);
    // One wall-clock origin per run; elapsed changes must not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  useEffect(() => {
    if (!running || reducedMotion) return;
    const animation = Animated.timing(scale, { toValue: PHASES[phaseIndex].to, duration: PHASE_SECONDS * 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [running, phaseIndex, scale, reducedMotion]);
  const start = () => { scale.setValue(0); setElapsed(0); setRunning(true); };
  const size = scale.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  return <Screen back title="Slow breathing" subtitle="In for four, hold for four, out for four, hold for four."
    footer={<Button label={running ? 'Stop' : done ? 'Go again' : 'Start'} variant={running ? 'secondary' : 'primary'} onPress={running ? () => { setRunning(false); record(elapsed); } : start} />}>
    <View style={styles.body}>
      <View style={styles.stage}><View style={styles.outline} />
        <Animated.View style={{ transform: [{ scale: reducedMotion ? 1 : size }] }}><Owl mood={4} pose="calm" size={190} /></Animated.View>
      </View>
      <View style={{ gap: 8, alignItems: 'center' }} accessibilityLiveRegion="polite">
        <AppText variant="display" align="center">{done ? 'Well done.' : running ? PHASES[phaseIndex].label : 'Ready when you are.'}</AppText>
        <AppText secondary align="center">{running ? `${count} seconds, round ${round} of ${TOTAL_ROUNDS}` : done ? 'Notice how you feel now.' : 'Two minutes is plenty.'}</AppText>
      </View>
    </View>
    {elapsed >= ROUND_SECONDS && !running ? <SuggestionCompletion route="/breathing" /> : null}
    <AppText variant="caption" muted align="center" style={{ marginTop: 24 }}>If you feel dizzy, return to normal breathing. This exercise does not replace professional support.</AppText>
  </Screen>;
}
const makeStyles = (c: Palette) => StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 40, paddingVertical: 28 },
  stage: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  outline: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 1, borderColor: c.border, borderRadius: 130 },
});
