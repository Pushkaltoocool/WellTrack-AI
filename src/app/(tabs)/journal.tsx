import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { EmotionRings } from '@/components/charts/TrendCharts';
import { ComposeFab } from '@/components/journal/ComposeFab';
import { JournalText } from '@/components/journal/JournalText';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chips, Notice, SectionTitle } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { emotionMeta, isHeavy } from '@/features/journal/analysis';
import { shareJournal } from '@/features/journal/exportJournal';
import { heavyStretch, topEmotions, triggerSummary, writingStats } from '@/features/journal/journalInsights';
import { emotionColor, loadJournal, toInsightEntries, type JournalEntry } from '@/features/journal/journalService';
import { promptForDay } from '@/features/journal/prompts';
import { searchEntries } from '@/features/journal/recall';
import { LETTER_MIN_DAYS } from '@/features/journal/weekLetter';
import { addDays, parseDateKey, todayKey } from '@/lib/dates';
import { AI_ENABLED } from '@/services/ai/llm';
import { useDbQuery } from '@/services/database/DataProvider';
import { listCheckIns } from '@/services/database/repositories';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { radii, type Palette } from '@/theme/tokens';

type Filter = 'all' | 'heavy' | 'light';

export default function JournalTab() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const today = todayKey();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const { data, loading, reload, error } = useDbQuery(async (d) => {
    const [entries, checkIns] = await Promise.all([loadJournal(d), listCheckIns(d, addDays(today, -6), today)]);
    const weekDays = new Set([...checkIns.map((c) => c.dateKey), ...entries.filter((e) => e.dateKey > addDays(today, -7)).map((e) => e.dateKey)]);
    return { entries, letterReady: weekDays.size >= LETTER_MIN_DAYS };
  }, [today]);
  const entries = data?.entries ?? [];
  const insight = toInsightEntries(entries);
  const month = insight.filter((e) => e.dateKey >= addDays(today, -29));
  const top = topEmotions(month, 3);
  const triggers = triggerSummary(month, 3);
  const heavy = heavyStretch(insight, today);
  const stats = writingStats(insight);
  const prompt = promptForDay(today);
  const searching = query.trim().length > 0;
  const hits = searching ? searchEntries(entries, query) : [];
  const shown = entries.filter((e) => filter === 'all' || (e.analysis && (filter === 'heavy' ? isHeavy(e.analysis) : !isHeavy(e.analysis) && e.analysis.sentiment > 0)));
  const groups = groupByMonth(shown);

  const exportAs = async (format: 'pdf' | 'text') => {
    setExporting(true);
    try {
      if (!(await shareJournal(entries, format, today))) Alert.alert('Sharing isn’t available', 'This device can’t open the share sheet.');
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };
  const onExport = () => Alert.alert('Export your journal', `${entries.length === 1 ? 'Your entry' : `All ${entries.length} entries, oldest first`}. The file is made on your phone and goes wherever you share it.`, [
    { text: 'PDF', onPress: () => void exportAs('pdf') },
    { text: 'Text (Markdown)', onPress: () => void exportAs('text') },
    { text: 'Cancel', style: 'cancel' },
  ]);

  const tools = entries.length ? <View style={styles.tools}>
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput value={query} onChangeText={setQuery} placeholder="Search words, feelings, #tags" placeholderTextColor={colors.textMuted}
        style={styles.searchInput} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search your journal" />
      {searching ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
      </Pressable> : null}
    </View>
    <Pressable onPress={onExport} disabled={exporting} accessibilityRole="button" accessibilityLabel="Export journal" style={({ pressed }) => [styles.iconButton, (pressed || exporting) && { opacity: 0.6 }]}>
      <Ionicons name="share-outline" size={20} color={colors.text} />
    </Pressable>
  </View> : null;

  return <View style={{ flex: 1 }}>
    <Screen title="Journal" subtitle={stats.entries ? `${stats.entries} ${stats.entries === 1 ? 'entry' : 'entries'} · ${stats.words.toLocaleString()} words · ${stats.daysWritten} ${stats.daysWritten === 1 ? 'day' : 'days'}` : 'Write it out. Wren helps you notice how you feel.'}
      right={tools} onRefresh={reload} refreshing={loading && !!data} bottomInset={70}>
      {error ? <Notice tone="danger" title="Could not load your journal">{error}</Notice> : null}

      {searching ? <>
        <AppText variant="caption" secondary style={{ marginBottom: 12 }}>{hits.length ? `${hits.length} ${hits.length === 1 ? 'entry matches' : 'entries match'}` : 'No entries match. Try another word, a feeling like “calm”, or a #tag.'}</AppText>
        <View style={{ gap: 10 }}>
          {hits.map((h) => <EntryCard key={h.entry.id} entry={h.entry} snippet={h.snippet} showYear />)}
        </View>
      </> : <>
        {heavy ? <Card style={styles.heavy}>
          <View style={{ gap: 10 }}>
            <View style={styles.row}><Ionicons name="cloud-outline" size={20} color={colors.rose} /><AppText variant="bodyStrong" style={{ fontSize: 18, flex: 1 }}>Heavier days lately</AppText></View>
            <AppText secondary>{`${heavy.heavyDays} of your last 7 days read heavy${heavy.topNegative.length ? `, mostly ${heavy.topNegative.map((n) => emotionMeta(n).label.toLowerCase()).join(', ')}` : ''}. That’s worth being gentle about.`}</AppText>
            <View style={styles.actions}>
              <Button label="Breathe" icon="leaf-outline" small onPress={() => router.push('/breathing')} />
              {AI_ENABLED ? <Button label="Talk to Wren" small variant="secondary" onPress={() => router.navigate('/coach')} /> : null}
              <Button label="Support" small variant="secondary" onPress={() => router.push('/support')} />
            </View>
          </View>
        </Card> : null}

        <Card>
          <View style={{ gap: 12 }}>
            <View style={styles.row}><Ionicons name="sparkles-outline" size={16} color={colors.peach} /><AppText variant="caption" muted>Prompt of the day</AppText></View>
            <AppText style={{ fontFamily: 'FrauncesItalic', fontSize: 22, lineHeight: 31 }}>{prompt}</AppText>
            <Button label="Start writing" icon="create-outline" small onPress={() => router.push({ pathname: '/entry', params: { prompt } })} style={{ alignSelf: 'flex-start' }} />
          </View>
        </Card>

        {data?.letterReady ? <Card onPress={() => router.push('/letter')} accessibilityLabel="Read Wren’s letter about your week" style={{ marginTop: 14 }}>
          <View style={[styles.row, { gap: 14 }]}>
            <View style={styles.letterIcon}><Ionicons name="mail-open-outline" size={22} color={colors.teal} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong" style={{ fontSize: 18 }}>Your week, from Wren</AppText>
              <AppText variant="caption" secondary>A short letter about the last seven days.</AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </View>
        </Card> : null}

        {top.length ? <>
          <SectionTitle title="This month in feelings" action="Trends" onAction={() => router.navigate('/trends')} />
          <Card>
            <View style={{ gap: 18 }}>
              <EmotionRings items={top.map((t) => ({ label: emotionMeta(t.name).label, share: t.share, color: emotionColor(t.name) }))} />
              {triggers.shine.length ? <TriggerLine icon="sunny-outline" label="Lifting you" items={triggers.shine.map((t) => t.phrase)} /> : null}
              {triggers.down.length ? <TriggerLine icon="cloud-outline" label="Weighing on you" items={triggers.down.map((t) => t.phrase)} /> : null}
              <SourceTag source="experimental" label="From your journal readings, not a diagnosis" />
            </View>
          </Card>
        </> : null}

        <SectionTitle title="Entries" />
        <View style={{ marginBottom: 14 }}>
          <Chips options={[{ value: 'all', label: 'All' }, { value: 'heavy', label: 'Heavier' }, { value: 'light', label: 'Lighter' }]} value={filter} onChange={setFilter} />
        </View>
        {!entries.length && !loading ? <Card>
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 18 }}>
            <Ionicons name="book-outline" size={30} color={colors.textMuted} />
            <AppText variant="bodyStrong" style={{ fontSize: 18 }}>Your first page is waiting</AppText>
            <AppText secondary align="center">Write a few lines about your day. Wren gently names the feelings in it, so patterns become easier to see.</AppText>
            <Button label="Start writing" onPress={() => router.push('/entry')} style={{ marginTop: 6 }} />
          </View>
        </Card> : null}
        {entries.length && !shown.length ? <AppText secondary>No entries match this filter yet.</AppText> : null}
        {groups.map(([label, list]) => <View key={label} style={{ gap: 10, marginBottom: 18 }}>
          <AppText variant="eyebrow" muted>{label}</AppText>
          {list.map((e) => <EntryCard key={e.id} entry={e} />)}
        </View>)}
      </>}
    </Screen>
    <ComposeFab />
  </View>;
}

function EntryCard({ entry, snippet, showYear }: { entry: JournalEntry; snippet?: string | null; showYear?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const d = parseDateKey(entry.dateKey);
  return <Pressable onPress={() => router.push({ pathname: '/entry', params: { id: String(entry.id) } })} accessibilityRole="button"
    accessibilityLabel={`Entry from ${d.toDateString()}`} style={({ pressed }) => [styles.entry, pressed && { opacity: 0.85 }]}>
    <View style={styles.dateCol}>
      <AppText variant="micro" muted>{(showYear ? d.toLocaleDateString(undefined, { month: 'short' }) : d.toLocaleDateString(undefined, { weekday: 'short' })).toUpperCase()}</AppText>
      <AppText variant="title" style={{ fontSize: 26 }}>{d.getDate()}</AppText>
      {showYear ? <AppText variant="micro" muted>{d.getFullYear()}</AppText> : null}
    </View>
    <View style={{ flex: 1, gap: 6 }}>
      {entry.prompt ? <AppText variant="bodyStrong" numberOfLines={2}>{entry.prompt}</AppText> : null}
      {snippet ? <AppText secondary numberOfLines={3}>{snippet}</AppText>
        : entry.plain.trim() ? <JournalText text={entry.body.split('\n').filter((l) => l.trim()).slice(0, 3).join('\n')} numberOfLines={3} /> : null}
      {entry.analysis?.emotions.length || entry.tags.length ? <View style={styles.feelings}>
        {entry.analysis?.emotions.map((em) => <View key={em.name} style={styles.feeling}>
          <View style={[styles.dot, { backgroundColor: emotionColor(em.name) }]} />
          <AppText variant="caption" secondary>{emotionMeta(em.name).label}</AppText>
        </View>)}
        {entry.tags.slice(0, 3).map((t) => <AppText key={t} variant="caption" muted>{`#${t}`}</AppText>)}
      </View> : null}
      {entry.analysis?.distress === 'urgent' ? <AppText variant="caption" color={colors.rose}>Support options are inside this entry.</AppText> : null}
    </View>
  </Pressable>;
}

function TriggerLine({ icon, label, items }: { icon: keyof typeof Ionicons.glyphMap; label: string; items: string[] }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return <View style={styles.row}>
    <Ionicons name={icon} size={18} color={colors.textSecondary} />
    <AppText variant="caption" secondary style={{ width: 118 }}>{label}</AppText>
    <AppText variant="bodyStrong" style={{ flex: 1 }}>{items.join(', ')}</AppText>
  </View>;
}

function groupByMonth(entries: JournalEntry[]): [string, JournalEntry[]][] {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const label = parseDateKey(e.dateKey).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    map.set(label, [...(map.get(label) ?? []), e]);
  }
  return [...map.entries()];
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  heavy: { marginBottom: 16, borderWidth: 1, borderColor: t.dark ? '#5A3236' : '#F0C9C5' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong },
  searchInput: { flex: 1, fontFamily: 'Figtree', fontSize: 16, color: c.text, paddingVertical: 10 },
  iconButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong },
  letterIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.tealSoft, justifyContent: 'center', alignItems: 'center' },
  entry: { flexDirection: 'row', gap: 16, padding: 18, borderRadius: radii.lg, backgroundColor: c.surface, ...(t.dark ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border } : {}) },
  dateCol: { width: 44, alignItems: 'center' },
  feelings: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 2 },
  feeling: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
