import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Notice } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { addDays, dateKey, daysBetween, parseDateKey, todayKey } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { createExam, deleteExam, listExams, listPastExams } from '@/services/database/repositories';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';
import type { Exam, ExamKind } from '@/types/domain';
import { countdown, EXAM_KINDS } from '@/features/exams/examMeta';

export default function ExamsScreen() {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, invalidate } = useData();
  const today = todayKey();
  const { data } = useDbQuery(async (d) => ({ upcoming: await listExams(d, today), past: await listPastExams(d, today, 10) }), [today]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExamKind>('exam');
  const [date, setDate] = useState(() => parseDateKey(addDays(today, 7)));
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const pickDate = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: date,
        mode: 'date',
        minimumDate: parseDateKey(today),
        onChange: (e, d) => {
          if (e.type === 'set' && d) setDate(d);
        },
      });
    }
  };

  const add = async () => {
    if (!title.trim()) return setError('Give it a name, e.g. “Chemistry midterm”.');
    setError(null);
    await createExam(db, { title, dateKey: dateKey(date), kind });
    setTitle('');
    invalidate();
  };

  const remove = (e: Exam) =>
    Alert.alert('Remove this date?', e.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteExam(db, e.id); invalidate(); } },
    ]);

  const next = data?.upcoming[0];
  const soon = next && daysBetween(today, next.dateKey) <= 7;
  return (
    <Screen back title="Exams & deadlines" subtitle="Wren adjusts suggestions in busy weeks and can remind you the evening before.">
      <View style={styles.stack}>
        {soon && next ? (
          <Card style={{ borderWidth: 1, borderColor: colors.amber }}>
            <View style={{ gap: 10 }}>
              <AppText variant="caption" color={colors.amber}>{`${countdown(next.dateKey, today)} · ${next.title}`}</AppText>
              <AppText variant="heading">A steadier exam week</AppText>
              <AppText variant="caption" secondary>Short focused blocks with real breaks, a consistent bedtime, and a little movement each day tend to help more than late nights.</AppText>
              <View style={styles.row}>
                <Button label="Start a focus block" small onPress={() => router.push('/focus')} />
                <Button label="Calm breathing" small variant="secondary" onPress={() => router.push('/breathing')} />
              </View>
            </View>
          </Card>
        ) : null}

        <Card>
          <View style={{ gap: 14 }}>
            <AppText variant="heading">Add a date</AppText>
            <TextField label="What is it?" value={title} onChangeText={setTitle} placeholder="e.g. Chemistry midterm" maxLength={80} error={error} />
            <View style={styles.chips}>
              {EXAM_KINDS.map((k) => (
                <Pressable key={k.value} onPress={() => setKind(k.value)} style={[styles.chip, kind === k.value && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: kind === k.value }}>
                  <Ionicons name={k.icon} size={16} color={kind === k.value ? colors.textOnAccent : colors.textSecondary} />
                  <AppText variant="caption" color={kind === k.value ? colors.textOnAccent : colors.text}>{k.label}</AppText>
                </Pressable>
              ))}
            </View>
            <View style={styles.dateRow}>
              <AppText variant="caption" secondary>Date</AppText>
              {Platform.OS === 'ios' ? (
                <DateTimePicker value={date} mode="date" display="compact" minimumDate={parseDateKey(today)} onChange={(_, d) => d && setDate(d)} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.teal} />
              ) : (
                <Button label={date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} small variant="secondary" icon="calendar-outline" onPress={pickDate} />
              )}
            </View>
            <Button label="Add" icon="add" onPress={() => void add()} />
            {!prefs.examReminders ? <AppText variant="caption" muted>Exam reminders are off. Turn them on in Settings → Reminders.</AppText> : null}
          </View>
        </Card>

        <AppText variant="heading">Coming up</AppText>
        {data && data.upcoming.length === 0 ? (
          <EmptyState compact icon="calendar-outline" title="Nothing scheduled" body="Add exams and deadlines to get a heads-up and gentler suggestions in busy weeks." />
        ) : null}
        {data?.upcoming.map((e) => <ExamRow key={e.id} exam={e} today={today} onRemove={() => remove(e)} />)}

        {data?.past.length ? (
          <>
            <Button label={showPast ? 'Hide past dates' : `Past dates (${data.past.length})`} variant="ghost" small onPress={() => setShowPast((v) => !v)} />
            {showPast ? data.past.map((e) => <ExamRow key={e.id} exam={e} today={today} onRemove={() => remove(e)} past />) : null}
          </>
        ) : null}
        <Notice tone="info">Dates are saved on this phone (and in your account backup if you’re signed in).</Notice>
      </View>
    </Screen>
  );
}

function ExamRow({ exam, today, onRemove, past }: { exam: Exam; today: string; onRemove: () => void; past?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const meta = EXAM_KINDS.find((k) => k.value === exam.kind) ?? EXAM_KINDS[3];
  const d = daysBetween(today, exam.dateKey);
  const tone = past ? colors.textMuted : d <= 2 ? colors.rose : d <= 7 ? colors.amber : colors.teal;
  return (
    <Card>
      <View style={styles.examRow}>
        <View style={[styles.examIcon, { backgroundColor: `${tone}22` }]}>
          <Ionicons name={meta.icon} size={22} color={tone} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">{exam.title}</AppText>
          <AppText variant="caption" secondary>
            {`${meta.label} · ${parseDateKey(exam.dateKey).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
          </AppText>
        </View>
        <AppText variant="caption" color={tone}>{countdown(exam.dateKey, today)}</AppText>
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${exam.title}`} style={{ padding: 4 }}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </Card>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  stack: { gap: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.surfaceAlt },
  chipOn: { backgroundColor: c.teal },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  examRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  examIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
