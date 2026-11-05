import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ProgressRing, Segmented } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { SuggestionCompletion } from '@/components/wellness/SuggestionCompletion';
import { useData } from '@/services/database/DataProvider';
import { logPractice } from '@/services/database/repositories';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { fonts, type Palette } from '@/theme/tokens';

type Mode = 'break' | 'focus';
const FOCUS = { '25': { focus: 25, rest: 5 }, '50': { focus: 50, rest: 10 }, '90': { focus: 90, rest: 15 } };
type Preset = keyof typeof FOCUS;
/** Wall-clock deadlines keep the timer correct after backgrounding. */
export default function FocusTimer() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, invalidate } = useData();
  const [mode, setMode] = useState<Mode>('break');
  const [length, setLength] = useState<'5' | '10' | '15'>('10');
  const [preset, setPreset] = useState<Preset>('50');
  const [phase, setPhase] = useState<Mode>('break');
  const [running, setRunning] = useState(false);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(600);
  const [cycles, setCycles] = useState(0);
  const total = mode === 'break' ? Number(length) * 60 : FOCUS[preset][phase === 'focus' ? 'focus' : 'rest'] * 60;
  const done = mode === 'break' && remaining === 0;
  useEffect(() => {
    if (!running || endAt === null) return;
    const tick = () => {
      const now = Date.now();
      if (now < endAt) { setRemaining(Math.ceil((endAt - now) / 1000)); return; }
      if (mode === 'break') { setRemaining(0); setRunning(false); setEndAt(null); return; }
      // Consume every elapsed block, including time spent in the background.
      let next = phase;
      let deadline = endAt;
      let completed = 0;
      while (deadline <= now) {
        if (next === 'focus') completed += 1;
        next = next === 'focus' ? 'break' : 'focus';
        deadline += FOCUS[preset][next === 'focus' ? 'focus' : 'rest'] * 60000;
      }
      if (completed) {
        setCycles((c) => c + completed);
        void logPractice(db, 'focus', completed * FOCUS[preset].focus * 60).then(invalidate).catch(() => undefined);
      }
      setPhase(next); setEndAt(deadline); setRemaining(Math.ceil((deadline - now) / 1000));
    };
    tick();
    const id = setInterval(tick, 500);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [running, endAt, mode, phase, preset, db, invalidate]);
  const reset = (seconds = total, nextPhase = mode) => { setRunning(false); setEndAt(null); setPhase(nextPhase); setRemaining(seconds); };
  const toggle = () => {
    if (running) { setRemaining(endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : remaining); setRunning(false); setEndAt(null); }
    else { const seconds = done ? total : remaining; setRemaining(seconds); setEndAt(Date.now() + seconds * 1000); setRunning(true); }
  };
  const mm = Math.floor(remaining / 60), ss = remaining % 60;
  return <Screen back title={mode === 'break' ? 'Take a break' : 'Time to focus'}
    subtitle={mode === 'break' ? 'Stand up, stretch, refill your water, look at something far away.' : 'A little structure for your study time. A real break after every block.'}
    footer={<View style={styles.controls}><Button label="Reset" icon="refresh" variant="secondary" onPress={() => reset(mode === 'break' ? Number(length) * 60 : FOCUS[preset].focus * 60)} />
      <Button label={running ? 'Pause' : done ? 'Start another' : remaining < total ? 'Resume' : mode === 'break' ? 'Start break' : 'Start focus'} onPress={toggle} variant={running ? 'secondary' : 'primary'} style={{ flex: 1 }} /></View>}>
    {mode === 'break' ? <Segmented options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }]} value={length} onChange={(v) => { setLength(v); reset(Number(v) * 60, 'break'); }} />
      : <Segmented options={(Object.keys(FOCUS) as Preset[]).map((v) => ({ value: v, label: `${FOCUS[v].focus} / ${FOCUS[v].rest}` }))} value={preset} onChange={(v) => { setPreset(v); reset(FOCUS[v].focus * 60, 'focus'); }} />}
    <View style={styles.stage}>
      <ProgressRing value={remaining / total} size={270} stroke={4} color={colors.teal}>
        <AppText style={styles.time} accessibilityRole="timer" accessibilityLabel={`${mm} minutes ${ss} seconds left`}>{mm}:{String(ss).padStart(2, '0')}</AppText>
        <AppText secondary>{done ? 'Break over. Back to it.' : running ? phase === 'focus' ? 'Focusing' : 'Breaking' : remaining < total ? 'Paused' : 'Ready'}</AppText>
      </ProgressRing>
      {mode === 'focus' ? <><AppText variant="caption" muted>{cycles} focus {cycles === 1 ? 'block' : 'blocks'} completed</AppText><Button label={phase === 'focus' ? 'Skip to break' : 'Skip to focus'} variant="ghost" onPress={() => {
        const next = phase === 'focus' ? 'break' : 'focus'; const seconds = FOCUS[preset][next === 'focus' ? 'focus' : 'rest'] * 60;
        setPhase(next); setRemaining(seconds); setEndAt(running ? Date.now() + seconds * 1000 : null);
      }} /></> : null}
    </View>
    {done ? <SuggestionCompletion route="/focus" /> : null}
    <Button label={mode === 'break' ? 'Switch to focus timer' : 'Switch to break timer'} variant="ghost" onPress={() => { const next = mode === 'break' ? 'focus' : 'break'; setMode(next); reset(next === 'break' ? Number(length) * 60 : FOCUS[preset].focus * 60, next); }} />
  </Screen>;
}
const makeStyles = (c: Palette) => StyleSheet.create({
  controls: { flexDirection: 'row', gap: 10 }, stage: { flex: 1, minHeight: 330, paddingVertical: 30, alignItems: 'center', justifyContent: 'center', gap: 18 },
  time: { fontFamily: fonts.display, fontSize: 68, lineHeight: 82, color: c.text, fontVariant: ['tabular-nums'] },
});
