import { Ionicons } from '@expo/vector-icons';
import Storage from 'expo-sqlite/kv-store';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/misc';
import { Owl } from '@/components/ui/Owl';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { loadJournal, toInsightEntries } from '@/features/journal/journalService';
import { aiWeekLetter, buildWeekLetter, LETTER_MIN_DAYS, type WeekLetter } from '@/features/journal/weekLetter';
import { addDays, formatDayMonth, todayKey } from '@/lib/dates';
import { AI_ENABLED, AI_VIA_PROXY, friendlyModelName } from '@/services/ai/llm';
import { useAccount } from '@/services/cloud/AccountProvider';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { listCheckIns, listPractices } from '@/services/database/repositories';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

const cacheKey = (to: string) => `welltrack.weekLetter.${to}`;

function readCached(local: WeekLetter): WeekLetter | null {
  try {
    const raw = Storage.getItemSync(cacheKey(local.to));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { facts: string[]; paragraphs: string[]; model: string | null };
    // Only reuse Wren's letter if it was written from exactly this week's facts.
    return saved.facts.join('\n') === local.facts.join('\n') ? { ...local, paragraphs: saved.paragraphs, source: 'ai', model: saved.model } : null;
  } catch {
    return null;
  }
}

export default function LetterScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { prefs } = useData();
  const { user } = useAccount();
  const today = todayKey();
  const [written, setWritten] = useState<WeekLetter | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const { data, loading, error } = useDbQuery(async (d) => {
    const from = addDays(today, -6);
    const [checkIns, journal, practices] = await Promise.all([listCheckIns(d, from, today), loadJournal(d, from, today), listPractices(d, from, today)]);
    const local = buildWeekLetter({ today, checkIns, journal: toInsightEntries(journal), practices, sleepGoalHours: prefs.sleepGoalHours });
    return local ? { local, cached: readCached(local) } : null;
  }, [today, prefs.sleepGoalHours]);

  const letter = written ?? data?.cached ?? data?.local ?? null;
  const consented = prefs.coachConsentAt !== null;

  const askWren = async () => {
    if (!data) return;
    if (!consented) {
      Alert.alert('Turn on Wren first', 'Wren’s letter uses the same summary the coach sees: your check-in numbers and the feelings named in your journal, never the entries themselves. Start a chat with Wren to agree to that first.', [
        { text: 'Not now', style: 'cancel' }, { text: 'Open Wren', onPress: () => router.navigate('/coach') },
      ]);
      return;
    }
    setBusy(true);
    setAiError(null);
    const idToken = AI_VIA_PROXY && user ? await user.getIdToken() : null;
    const res = await aiWeekLetter(data.local, { idToken });
    setBusy(false);
    if (res.error) setAiError(res.error);
    setWritten(res.letter);
    if (res.letter.source === 'ai') {
      try { Storage.setItemSync(cacheKey(res.letter.to), JSON.stringify({ facts: res.letter.facts, paragraphs: res.letter.paragraphs, model: res.letter.model })); } catch { /* shown anyway */ }
    }
  };

  return <Screen back title="Your week" subtitle={letter ? `${formatDayMonth(letter.from)} – ${formatDayMonth(letter.to)}` : undefined}>
    {error ? <Notice tone="danger" title="Could not load your week">{error}</Notice> : null}
    {!loading && !letter && !error ? <View style={styles.empty}>
      <Owl mood={3} size={96} />
      <AppText variant="heading" align="center">Not enough of the week yet</AppText>
      <AppText secondary align="center">{`Wren writes once you’ve checked in or journaled on at least ${LETTER_MIN_DAYS} of the last 7 days.`}</AppText>
      <Button label="Check in now" onPress={() => router.push('/checkin')} style={{ marginTop: 8 }} />
    </View> : null}
    {letter ? <>
      <View style={styles.paper}>
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading">Dear you,</AppText>
            <AppText variant="caption" muted>{`${letter.daysLogged} of 7 days logged`}</AppText>
          </View>
          <Owl mood={4} size={54} />
        </View>
        {letter.paragraphs.map((p, i) => <AppText key={i} style={styles.para}>{p}</AppText>)}
        <AppText style={styles.sign}>— Wren</AppText>
      </View>
      <View style={{ marginTop: 14, gap: 12 }}>
        <SourceTag source={letter.source === 'ai' ? 'ai' : 'rule'} label={letter.source === 'ai' ? `Written by AI (${friendlyModelName(letter.model)}) from your week’s numbers and feelings` : 'Written on your phone from your check-ins and journal'} />
        {aiError ? <Notice tone="warn" title="Showing the on-device letter">{aiError}</Notice> : null}
        {AI_ENABLED && letter.source === 'local' ? <Button label="Ask Wren to write it" icon="sparkles-outline" variant="secondary" loading={busy} onPress={askWren} /> : null}
        <AppText variant="caption" muted>Based only on what you logged. Not a diagnosis. If things feel heavy, Support is always one tap away.</AppText>
        <Button label="Support" icon="heart-outline" variant="ghost" small onPress={() => router.push('/support')} style={{ alignSelf: 'flex-start' }} />
      </View>
    </> : null}
    {loading && !data ? <View style={styles.empty}><Ionicons name="mail-outline" size={28} color={colors.textMuted} /></View> : null}
  </Screen>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  empty: { alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 12 },
  paper: { backgroundColor: c.surface, borderRadius: 28, padding: 24, paddingTop: 22, gap: 14, borderLeftWidth: 3, borderLeftColor: c.peach, ...t.shadow.card },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  para: { fontFamily: 'Fraunces', fontSize: 18, lineHeight: 28, color: c.text, paddingRight: 4 },
  sign: { fontFamily: 'FrauncesItalic', fontSize: 20, color: c.teal, alignSelf: 'flex-end', marginTop: 4 },
});
