import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/misc';
import { MOOD_NAMES, Owl } from '@/components/ui/Owl';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { RiskCard } from '@/components/wellness/RiskCard';
import { RecommendationCard } from '@/components/wellness/WellnessCards';
import { NOTES_MAX, NUMERIC_FIELDS, parseNumber, validateCheckIn, type FieldSpec, type ValidationErrors } from '@/features/wellness/checkinValidation';
import { acceptRecommendationGoal, saveCheckIn } from '@/features/wellness/wellnessService';
import { formatLongDate, parseDateKey, todayKey } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { getCheckIn, listRecommendations, setRecommendationStatus } from '@/services/database/repositories';
import { predictStress } from '@/services/ml/stressModel';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { fonts, type Palette } from '@/theme/tokens';
import type { CheckIn, CheckInInput } from '@/types/domain';

const DEFAULTS = { sleepHours: 7, studyHours: 4, academicPressure: 3, screenTimeHours: 3, physicalActivityMinutes: 30, socialHours: 1, extracurricularHours: 0, stressLevel: 3, mood: 3, notes: '' };
const QUESTIONS = [
  ['How are you feeling today?', 'Pick the owl that looks most like you right now.'],
  ['How long did you sleep?', 'Last night, roughly. Half hours are fine.'],
  ['How many hours are you studying today?', 'Classes and self-study together. A guess is fine.'],
  ['How heavy does academic pressure feel?', 'Right now, not on your worst day.'],
  ['How much leisure screen time today?', 'Scrolling, streaming and games. Not study.'],
  ['Anything on your mind?', 'Optional. A sentence is plenty, and it stays on this phone.'],
];
const PRESSURE = ['Barely there', 'Light', 'Manageable', 'Heavy', 'Overwhelming'];
const NUMBER_KEY: Record<number, string> = { 2: 'sleepHours', 3: 'studyHours', 5: 'screenTimeHours' };
const CHIPS: Record<number, number[]> = { 2: [5, 6, 7, 8, 9], 3: [0, 2, 4, 6, 8], 5: [1, 2, 3, 4, 5] };

export default function CheckInScreen() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ date?: string; step?: string; mood?: string }>();
  const presetMood = ['1', '2', '3', '4', '5'].includes(params.mood ?? '') ? Number(params.mood) : DEFAULTS.mood;
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= todayKey() ? params.date : todayKey();
  const { db, prefs, invalidate } = useData();
  const [values, setValues] = useState<CheckInInput>({ ...DEFAULTS, mood: presetMood, dateKey: date });
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(params.step === '6' ? 6 : 1);
  const [saved, setSaved] = useState<CheckIn | null>(null);
  const [extra, setExtra] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getCheckIn(db, date);
        if (cancelled) return;
        const v = c ? { ...c } : { ...DEFAULTS, mood: presetMood, dateKey: date };
        setExisting(!!c); setValues(v);
        setTexts(Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, String(v[f.key])])));
        setLoadError(null);
      } catch { if (!cancelled) setLoadError('Your check-in could not be loaded. Try again before making changes.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [db, date, attempt, presetMood]);
  const recs = useDbQuery((d) => listRecommendations(d, { dateKey: date }), [saved, date]);
  const field = NUMERIC_FIELDS.find((f) => f.key === NUMBER_KEY[step]);
  const setNumber = (f: FieldSpec, text: string) => {
    setTexts((t) => ({ ...t, [f.key]: text })); setValues((v) => ({ ...v, [f.key]: parseNumber(text) }));
    setErrors((e) => ({ ...e, [f.key]: undefined, form: undefined }));
  };
  const adjust = (f: FieldSpec, dir: number) => {
    const current = values[f.key] as number;
    setNumber(f, String(Math.min(f.max, Math.max(f.min, (Number.isFinite(current) ? current : f.min) + dir * f.step))));
  };
  const finish = async () => {
    const e = validateCheckIn(values); setErrors(e);
    if (Object.keys(e).length) {
      if (e.sleepHours) setStep(2); else if (e.studyHours) setStep(3); else if (e.screenTimeHours) setStep(5); else { setStep(6); setExtra(true); }
      return;
    }
    setSaving(true);
    try { const entry = await saveCheckIn(db, prefs, { ...values, notes: values.notes.trim() }); invalidate(); setSaved(entry); }
    catch { setErrors({ form: 'Could not save your check-in. Your answers are still here. Please try again.' }); }
    finally { setSaving(false); }
  };
  const next = () => {
    if (field) { const e = validateCheckIn(values); if (e[field.key]) { setErrors({ [field.key]: e[field.key] }); return; } }
    setErrors({}); setStep((s) => Math.min(6, s + 1));
  };
  const prediction = saved ? predictStress(saved) : null;
  const controls = !saved ? <View style={styles.controls}>
    {step > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Previous question" onPress={() => { setErrors({}); setStep((s) => s - 1); }} style={styles.back}><Ionicons name="arrow-back" size={21} color={colors.text} /></Pressable> : null}
    <Button label={step === 6 ? existing ? 'Save changes' : 'Finish check-in' : 'Continue'} onPress={step === 6 ? finish : next} loading={saving} disabled={loading || !!loadError} testID={step === 6 ? 'save-checkin' : 'continue-checkin'} style={{ flex: 1 }} />
  </View> : <Button label="Done" onPress={() => router.replace('/home')} />;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen back right={<AppText variant="caption" muted>{saved ? 'Daily check-in' : `${step} of 6`}</AppText>} footer={controls}>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} /> : loadError ? <View style={{ gap: 16 }}><Notice tone="danger">{loadError}</Notice><Button label="Try again" onPress={() => { setLoading(true); setAttempt((a) => a + 1); }} /></View> : saved ? <View style={{ gap: 18 }}>
        <AppText variant="caption" color={colors.teal}>Saved {date === todayKey() ? 'for today' : formatLongDate(parseDateKey(date))}</AppText>
        <AppText variant="display">Thank you{prefs.displayName.trim() ? `, ${prefs.displayName.trim()}` : ''}.</AppText>
        <AppText secondary>Here’s your day at a glance.</AppText>
        <View style={styles.glance}>
          <View style={styles.chip}><Owl mood={values.mood} size={28} /><AppText>{MOOD_NAMES[values.mood - 1]}</AppText></View>
          {[`${values.sleepHours} h sleep`, `${values.studyHours} h study`, `Pressure ${values.academicPressure} of 5`, `${values.screenTimeHours} h screens`].map((text) => <View key={text} style={styles.chip}><AppText>{text}</AppText></View>)}
        </View>
        <SourceTag source="self-reported" />
        {prediction ? <RiskCard risk={prediction.predicted} onPress={() => router.push('/stress')} /> : null}
        {recs.data?.slice(0, 2).map((rec) => <RecommendationCard key={rec.id} rec={rec} onGoal={async (r, action) => { try { await acceptRecommendationGoal(db, r, action); invalidate(); } catch { Alert.alert('Could not set goal', 'Please try again.'); } }} onStatus={async (r, status) => { try { await setRecommendationStatus(db, r.id, status); invalidate(); } catch { Alert.alert('Could not update suggestion', 'Please try again.'); } }} />)}
      </View> : <View style={{ gap: 22 }}>
        <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 6, now: step }}>
          {[1, 2, 3, 4, 5, 6].map((n) => <View key={n} style={[styles.progressPart, { backgroundColor: n <= step ? colors.text : colors.surfacePressed }]} />)}
        </View>
        <View style={{ gap: 10 }}><AppText variant="display" style={{ fontSize: 36, lineHeight: 41 }} accessibilityRole="header">{QUESTIONS[step - 1][0]}</AppText><AppText secondary>{QUESTIONS[step - 1][1]}</AppText></View>
        {step === 1 ? <>
          <View style={styles.owlStage}><Owl mood={values.mood} size={184} /><AppText variant="heading">{MOOD_NAMES[values.mood - 1]}</AppText></View>
          <View style={styles.moods} accessibilityRole="radiogroup" accessibilityLabel="Overall mood">
            {MOOD_NAMES.map((name, i) => <Pressable key={name} accessibilityRole="radio" accessibilityLabel={`${name}, ${i + 1} of 5`} accessibilityState={{ selected: values.mood === i + 1 }} onPress={() => setValues((v) => ({ ...v, mood: i + 1 }))} style={styles.mood}>
              <View style={[styles.moodRing, values.mood === i + 1 && { borderColor: colors.text }]}><Owl mood={i + 1} size={46} /></View>
              <AppText variant="caption" color={values.mood === i + 1 ? colors.text : colors.textMuted} style={{ fontSize: 12 }}>{name}</AppText>
            </Pressable>)}
          </View>
        </> : null}
        {field ? <View style={{ gap: 26, paddingVertical: 30 }}>
          <View style={styles.numberRow}>
            <StepButton icon="remove" label={`Decrease ${field.label}`} onPress={() => adjust(field, -1)} />
            <View style={{ flex: 1, alignItems: 'center' }}><TextInput value={texts[field.key] ?? ''} onChangeText={(t) => setNumber(field, t)} keyboardType="decimal-pad" selectTextOnFocus maxLength={5} accessibilityLabel={`${field.label} in hours`} style={styles.bigNumber} /><AppText secondary>hours</AppText></View>
            <StepButton icon="add" label={`Increase ${field.label}`} onPress={() => adjust(field, 1)} />
          </View>
          <View style={styles.presets} accessibilityRole="radiogroup" accessibilityLabel="Suggested hours">
            {CHIPS[step].map((n) => <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`${n} hours`} accessibilityState={{ selected: values[field.key] === n }} onPress={() => setNumber(field, String(n))} style={[styles.preset, values[field.key] === n && { backgroundColor: colors.surfacePressed }]}><AppText>{n}</AppText></Pressable>)}
          </View>
          {errors[field.key] ? <AppText color={colors.rose}>{errors[field.key]}</AppText> : null}
          {step === 2 || step === 3 ? <AppText variant="caption" muted align="center">Used by the experimental stress estimate.</AppText> : null}
        </View> : null}
        {step === 4 ? <View style={{ gap: 10 }}>
          {PRESSURE.map((label, i) => <Pressable key={label} accessibilityRole="radio" accessibilityLabel={`${label}, ${i + 1} of 5`} accessibilityState={{ selected: values.academicPressure === i + 1 }} onPress={() => setValues((v) => ({ ...v, academicPressure: i + 1 }))} style={[styles.pressure, values.academicPressure === i + 1 && styles.pressureSelected]}>
            <View style={[styles.level, values.academicPressure === i + 1 && { backgroundColor: colors.text }]}><AppText color={values.academicPressure === i + 1 ? colors.bg : colors.textSecondary}>{i + 1}</AppText></View><AppText>{label}</AppText>
          </Pressable>)}
          <AppText variant="bodyStrong" style={{ marginTop: 16 }}>And your stress level?</AppText>
          <View style={styles.presets} accessibilityRole="radiogroup" accessibilityLabel="Self-reported stress">
            {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`Stress ${n} of 5`} accessibilityState={{ selected: values.stressLevel === n }} onPress={() => setValues((v) => ({ ...v, stressLevel: n }))} style={[styles.preset, values.stressLevel === n && { backgroundColor: colors.surfacePressed }]}><AppText>{n}</AppText></Pressable>)}
          </View><AppText variant="caption" muted>1 · Not at all                         5 · Extremely</AppText>
        </View> : null}
        {step === 6 ? <>
          <TextInput multiline value={values.notes} onChangeText={(notes) => setValues((v) => ({ ...v, notes }))} placeholder="One small thing that went well today…" placeholderTextColor={colors.textMuted} maxLength={NOTES_MAX} accessibilityLabel="Reflection" style={styles.notes} />
          <AppText variant="caption" muted align="right">{values.notes.length}/{NOTES_MAX}</AppText>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: extra }} onPress={() => setExtra((v) => !v)} style={styles.extra}><AppText color={colors.primary}>More about your day (optional)</AppText><Ionicons name={extra ? 'chevron-up' : 'chevron-down'} color={colors.primary} size={18} /></Pressable>
          {!extra ? <AppText variant="caption" muted>{`Included daily details: ${values.physicalActivityMinutes} min of activity, ${values.socialHours} h social time, ${values.extracurricularHours} h extracurriculars. Tap above to adjust.`}</AppText> : null}
          {extra ? <Card>{NUMERIC_FIELDS.slice(3).map((f) => <View key={f.key} style={styles.extraField}>
            <AppText style={{ flex: 1 }}>{f.label}</AppText><StepButton icon="remove" label={`Decrease ${f.label}`} onPress={() => adjust(f, -1)} />
            <TextInput value={texts[f.key] ?? ''} onChangeText={(t) => setNumber(f, t)} keyboardType="decimal-pad" accessibilityLabel={`${f.label} in ${f.unit}`} style={styles.smallNumber} /><StepButton icon="add" label={`Increase ${f.label}`} onPress={() => adjust(f, 1)} />
            {errors[f.key] ? <AppText variant="caption" color={colors.rose}>{errors[f.key]}</AppText> : null}
          </View>)}</Card> : null}
          <AppText variant="caption" muted>Your answers stay on this phone. You can edit them any time.</AppText>
        </> : null}
        {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
      </View>}
    </Screen>
  </KeyboardAvoidingView>;
}
function StepButton({ icon, label, onPress }: { icon: 'remove' | 'add'; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.stepButton}><Ionicons name={icon} size={24} color={colors.text} /></Pressable>;
}
const makeStyles = (c: Palette) => StyleSheet.create({
  controls: { flexDirection: 'row', gap: 10 }, back: { width: 54, minHeight: 54, borderRadius: 27, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: 6, marginBottom: 4 }, progressPart: { flex: 1, height: 4, borderRadius: 2 },
  owlStage: { alignItems: 'center', gap: 14, paddingVertical: 16 }, moods: { flexDirection: 'row', gap: 2 }, mood: { flex: 1, minHeight: 84, alignItems: 'center', gap: 8 },
  moodRing: { padding: 3, borderWidth: 1.5, borderRadius: 30, borderColor: 'transparent' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, bigNumber: { width: '100%', fontFamily: fonts.display, color: c.text, fontSize: 80, lineHeight: 100, textAlign: 'center', padding: 0 },
  stepButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
  presets: { flexDirection: 'row', gap: 8, justifyContent: 'center' }, preset: { flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center' },
  pressure: { flexDirection: 'row', gap: 14, padding: 14, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  pressureSelected: { borderColor: c.text, backgroundColor: c.surfaceAlt }, level: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfacePressed, alignItems: 'center', justifyContent: 'center' },
  notes: { minHeight: 230, borderRadius: 24, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: 20, textAlignVertical: 'top', fontFamily: fonts.italic, fontSize: 21, lineHeight: 30, color: c.text },
  extra: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, extraField: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingVertical: 12 },
  smallNumber: { width: 48, color: c.text, fontFamily: fonts.body, fontSize: 18, textAlign: 'center' },
  glance: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 40, backgroundColor: c.surface, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', gap: 8, alignItems: 'center' },
});
