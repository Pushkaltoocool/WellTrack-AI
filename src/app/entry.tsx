import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryReading } from '@/components/journal/EntryReading';
import { BLOCK_STYLES, JournalSpans, JournalText } from '@/components/journal/JournalText';
import { useJournalAi } from '@/components/journal/useJournalAi';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import type { JournalAnalysis } from '@/features/journal/analysis';
import { deeperQuestion } from '@/features/journal/deeper';
import { analyzeAndStore, saveEntry, SUGGESTED_TAGS, toEntry, type JournalEntry } from '@/features/journal/journalService';
import { blockAt, parseTags, setBlock, stripMarkdown, toggleInline, type Block, type InlineMark } from '@/features/journal/markdown';
import { morePrompts, promptForDay } from '@/features/journal/prompts';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { dateKey as toDateKey, parseDateKey, todayKey } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { deleteJournalEntry, getJournalEntry } from '@/services/database/repositories';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { fonts, radii, type Palette } from '@/theme/tokens';

export default function EntryRoute() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ id?: string; prompt?: string; date?: string }>();
  const id = params.id ? Number(params.id) : null;
  const { data, loading } = useDbQuery(async (d) => (id ? await getJournalEntry(d, id) : null), [id]);
  if (id && !data) {
    return <View style={[styles.root, styles.center]}>
      {loading ? <ActivityIndicator color={colors.text} /> : <>
        <AppText secondary>This entry no longer exists.</AppText>
        <Button label="Close" small variant="secondary" onPress={() => router.back()} />
      </>}
    </View>;
  }
  return <EntryScreen key={data?.id ?? 'new'} initial={data ? toEntry(data) : null}
    initialPrompt={params.prompt ?? null} initialDate={params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayKey()} />;
}

type Panel = null | 'plus' | 'format';
type SheetName = null | 'details' | 'tags' | 'prompts';

function EntryScreen({ initial, initialPrompt, initialDate }: { initial: JournalEntry | null; initialPrompt: string | null; initialDate: string }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, updatePrefs, invalidate } = useData();
  const ai = useJournalAi();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const [mode, setMode] = useState<'edit' | 'read'>(initial ? 'read' : 'edit');
  const [entryId, setEntryId] = useState<number | null>(initial?.id ?? null);
  const [body, setBody] = useState(initial?.body ?? '');
  const [prompt, setPrompt] = useState<string | null>(initial?.prompt ?? initialPrompt);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [day, setDay] = useState(initial?.dateKey ?? initialDate);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [pendingSel, setPendingSel] = useState<{ start: number; end: number } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [analysis, setAnalysis] = useState<JournalAnalysis | null>(initial?.analysis ?? null);
  const [analyzedBody, setAnalyzedBody] = useState<string | null>(initial?.analysis ? initial.body : null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [deeperBusy, setDeeperBusy] = useState(false);
  const [editStart, setEditStart] = useState(() => Date.now());
  const [savedSeconds, setSavedSeconds] = useState(initial?.writingSeconds ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const hasText = stripMarkdown(body).trim().length > 0;

  // Autosave when the screen is dismissed by a gesture or the system back button. `savedId`
  // remembers an id created by that path so a later save updates the same row.
  const savedId = useRef<number | null>(null);
  const latest = useRef({ body, prompt, tags, day, entryId, mode, editStart });
  useEffect(() => {
    latest.current = { body, prompt, tags, day, entryId, mode, editStart };
  });
  useEffect(() => () => {
    const s = latest.current;
    if (s.mode !== 'edit' || !stripMarkdown(s.body).trim()) return;
    void saveEntry(db, { id: s.entryId ?? savedId.current, dateKey: s.day, body: s.body, prompt: s.prompt, tags: s.tags, addSeconds: (Date.now() - s.editStart) / 1000 })
      .then((id) => { savedId.current = id; invalidate(); }).catch(() => undefined);
  }, [db, invalidate]);

  const persist = async (): Promise<number | null> => {
    if (!hasText && !entryId) return null;
    const t = Date.now();
    const secs = (t - editStart) / 1000;
    const id = await saveEntry(db, { id: entryId ?? savedId.current, dateKey: day, body, prompt, tags, addSeconds: mode === 'edit' ? secs : 0 });
    savedId.current = id;
    if (mode === 'edit') { setSavedSeconds((s) => s + Math.round(secs)); setEditStart(t); }
    setEntryId(id);
    invalidate();
    return id;
  };

  const analyze = async (id: number, useAi: boolean) => {
    setAnalyzing(true);
    setAiError(null);
    try {
      const r = await analyzeAndStore(db, { id, body, prompt, dateKey: day }, { useAi, idToken: await ai.idToken() });
      setAnalysis(r.analysis);
      setAnalyzedBody(body);
      setAiError(r.aiError ?? null);
    } catch {
      setAiError('This entry couldn’t be read right now.');
    } finally {
      setAnalyzing(false);
      invalidate();
    }
  };

  const finish = async (askAi = false) => {
    if (saving) return;
    Keyboard.dismiss();
    setPanel(null);
    setSaving(true);
    try {
      const useAi = askAi ? await ai.requestConsent() : ai.allowed;
      const id = await persist();
      if (!id) { router.back(); return; }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setMode('read');
      const upgrade = useAi && analysis?.source === 'local';
      if (body !== analyzedBody || !analysis || upgrade) void analyze(id, useAi);
    } catch {
      Alert.alert('Couldn’t save this entry', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (mode === 'edit' && hasText) { void finish(); return; }
    if (mode === 'edit' && entryId && !hasText) { confirmDelete(); return; }
    router.back();
  };

  const confirmDelete = () => {
    if (!entryId) { setBody(''); router.back(); return; }
    Alert.alert('Delete this entry?', 'It will be removed from this phone and from your next backup.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        latest.current.mode = 'read';
        await deleteJournalEntry(db, entryId);
        invalidate();
        setSheet(null);
        router.back();
      } },
    ]);
  };

  const goDeeper = async () => {
    if (deeperBusy) return;
    setDeeperBusy(true);
    try {
      const { question } = await deeperQuestion(stripMarkdown(body), prompt, { useAi: ai.allowed, idToken: await ai.idToken(), seed: body.length });
      const base = body.replace(/\s+$/, '');
      const next = `${base}${base ? '\n\n' : ''}### ${question}\n`;
      setBody(next);
      setPendingSel({ start: next.length, end: next.length });
      input.current?.focus();
    } finally {
      setDeeperBusy(false);
    }
  };

  const applyInline = (mark: InlineMark) => {
    const r = toggleInline(body, selection, mark);
    setBody(r.text);
    setSelection(r.selection);
    setPendingSel(r.selection);
  };
  const applyBlock = (block: Block) => {
    const r = setBlock(body, selection.start, block);
    setBody(r.text);
    const s = { start: r.cursor, end: r.cursor };
    setSelection(s);
    setPendingSel(s);
  };
  const openFormat = () => {
    if (panel === 'format') { setPanel(null); input.current?.focus(); return; }
    Keyboard.dismiss();
    setPanel('format');
  };
  const openSheet = (s: SheetName) => { Keyboard.dismiss(); setPanel(null); setNow(Date.now()); setSheet(s); };

  const sessionSeconds = mode === 'edit' ? Math.max(0, Math.round((now - editStart) / 1000)) : 0;
  const plain = stripMarkdown(body);
  const words = plain.trim() ? plain.trim().split(/\s+/).length : 0;

  const header = <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
    <Pressable onPress={() => openSheet('details')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Entry details" style={styles.headerIcon}>
      <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
    </Pressable>
    <Pressable onPress={() => openSheet('tags')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit tags" style={styles.headerIcon}>
      <Ionicons name="pricetag-outline" size={21} color={colors.text} />
    </Pressable>
    <View style={{ flex: 1 }} />
    {mode === 'read' ? <Pressable onPress={() => { setMode('edit'); setEditStart(Date.now()); setTimeout(() => input.current?.focus(), 250); }} accessibilityRole="button" style={styles.pill}>
      <Ionicons name="create-outline" size={18} color={colors.text} /><AppText variant="bodyStrong">Edit</AppText>
    </Pressable> : null}
    <Pressable onPress={() => (mode === 'read' ? (entryId ? void analyze(entryId, true) : undefined) : void finish(true))} disabled={!hasText || analyzing}
      accessibilityRole="button" accessibilityLabel="Ask Wren to read this entry" style={[styles.pill, (!hasText || analyzing) && { opacity: 0.5 }]}>
      <Ionicons name="sparkles" size={18} color={colors.text} /><AppText variant="bodyStrong">Wren</AppText>
    </Pressable>
    {mode === 'read' ? <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}>
      <Ionicons name="close" size={22} color={colors.text} />
    </Pressable> : null}
  </View>;

  const meta = <View style={styles.metaRow}>
    <AppText variant="caption" muted>{parseDateKey(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</AppText>
    {tags.map((t) => <View key={t} style={styles.tag}><AppText variant="caption" secondary>{`#${t}`}</AppText></View>)}
  </View>;

  if (mode === 'read') {
    return <View style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={[styles.readContent, { paddingBottom: insets.bottom + 40 }]}>
        {meta}
        {prompt ? <AppText variant="heading" color={colors.textSecondary} style={{ marginBottom: 12 }}>{prompt}</AppText> : null}
        <JournalText text={body} />
        <View style={{ height: 28 }} />
        <EntryReading analysis={analysis} analyzing={analyzing} aiError={aiError} onAskAi={entryId ? () => void (async () => { if (await ai.requestConsent()) void analyze(entryId, true); })() : undefined} />
      </ScrollView>
      {renderSheets()}
    </View>;
  }

  return <KeyboardAvoidingView style={styles.root} behavior="padding">
    {header}
    <ScrollView contentContainerStyle={styles.editContent} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => setPanel((p) => (p === 'plus' ? null : p))}>
      {meta}
      {prompt ? <View style={styles.promptRow}>
        <AppText variant="heading" color={colors.textSecondary} style={{ flex: 1 }}>{prompt}</AppText>
        <Pressable onPress={() => setPrompt(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove prompt"><Ionicons name="close-circle" size={22} color={colors.borderStrong} /></Pressable>
      </View> : null}
      <TextInput
        ref={input}
        multiline
        autoFocus={!initial}
        scrollEnabled={false}
        onChangeText={setBody}
        onSelectionChange={(e) => { setSelection(e.nativeEvent.selection); if (pendingSel) setPendingSel(null); }}
        selection={pendingSel ?? undefined}
        onFocus={() => setPanel(null)}
        placeholder={prompt ? 'Write whatever comes…' : 'What’s on your mind?'}
        placeholderTextColor={colors.textMuted}
        textAlignVertical="top"
        accessibilityLabel="Journal entry"
        style={[styles.input, hasText ? BLOCK_STYLES.body : styles.placeholder, prefs.journalLargeText && hasText ? { fontSize: 23, lineHeight: 34 } : null]}>
        <JournalSpans text={body} editing large={prefs.journalLargeText} />
      </TextInput>
    </ScrollView>

    {panel === 'plus' ? <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(160)} style={[styles.popover, { bottom: 76 + (panel === 'plus' ? 0 : 0) }]}>
      <MenuItem icon="bulb-outline" label="Journaling suggestions" onPress={() => openSheet('prompts')} />
      <MenuItem icon="pricetags-outline" label="Edit tags" onPress={() => openSheet('tags')} />
      <MenuItem icon="calendar-outline" label="Change date" onPress={() => openSheet('details')} />
      <AppText variant="caption" muted style={{ paddingHorizontal: 16, paddingTop: 6 }}>Tip: use your keyboard’s microphone to dictate.</AppText>
    </Animated.View> : null}

    {panel === 'format' ? <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(160)} style={[styles.formatPanel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.formatRow}>
        <View style={styles.segment}>
          {([['bold', 'B'], ['italic', 'I'], ['underline', 'U'], ['strike', 'S']] as const).map(([mark, label], i) => (
            <Pressable key={mark} onPress={() => applyInline(mark)} accessibilityRole="button" accessibilityLabel={mark}
              style={({ pressed }) => [styles.segBtn, i > 0 && styles.segDivider, pressed && { backgroundColor: colors.surfacePressed }]}>
              <AppText style={[styles.segLabel, mark === 'bold' && { fontFamily: fonts.bold }, mark === 'italic' && { fontFamily: fonts.italic }, mark === 'underline' && { textDecorationLine: 'underline' }, mark === 'strike' && { textDecorationLine: 'line-through' }]}>{label}</AppText>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => applyBlock(blockAt(body, selection.start) === 'quote' ? 'body' : 'quote')} accessibilityRole="button" accessibilityLabel="Quote"
          style={[styles.quoteBtn, blockAt(body, selection.start) === 'quote' && { backgroundColor: colors.ink }]}>
          <Ionicons name="chatbox-ellipses-outline" size={22} color={blockAt(body, selection.start) === 'quote' ? colors.onInk : colors.text} />
        </Pressable>
        <Pressable onPress={() => { setPanel(null); input.current?.focus(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close formatting" style={{ padding: 6 }}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
        {([['title', 'Title', 26], ['heading', 'Heading', 21], ['subheading', 'Subheading', 17], ['body', 'Body', 16]] as const).map(([block, label, size]) => {
          const active = blockAt(body, selection.start) === block;
          return <Pressable key={block} onPress={() => applyBlock(block)} accessibilityRole="button" accessibilityState={{ selected: active }}
            style={[styles.blockBtn, active && { backgroundColor: colors.ink }]}>
            <AppText color={active ? colors.onInk : colors.text} style={{ fontSize: size, lineHeight: size + 8, fontFamily: block === 'body' ? fonts.body : block === 'subheading' ? fonts.semibold : fonts.bold }}>{label}</AppText>
          </Pressable>;
        })}
      </ScrollView>
    </Animated.View> : <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable onPress={() => setPanel((p) => (p === 'plus' ? null : 'plus'))} accessibilityRole="button" accessibilityLabel="More" style={[styles.round, panel === 'plus' && { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name={panel === 'plus' ? 'close' : 'add'} size={26} color={colors.text} />
      </Pressable>
      <Pressable onPress={openFormat} accessibilityRole="button" accessibilityLabel="Text formatting" style={styles.round}>
        <AppText style={{ fontFamily: fonts.bold, fontSize: 17 }}>A<AppText style={{ fontFamily: fonts.italic, fontSize: 17 }}>a</AppText></AppText>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => void goDeeper()} disabled={deeperBusy} accessibilityRole="button" accessibilityLabel="Keep going: Wren adds a follow-up question" style={[styles.deeper, deeperBusy && { opacity: 0.6 }]}>
        {deeperBusy ? <ActivityIndicator size="small" color={colors.text} /> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name="sparkles-outline" size={17} color={colors.text} /><AppText variant="bodyStrong" style={{ fontSize: 17 }}>Keep going</AppText></View>}
      </Pressable>
      <Pressable onPress={close} disabled={saving} accessibilityRole="button" accessibilityLabel={hasText ? 'Save entry' : 'Close'} style={[styles.round, styles.done]}>
        {saving ? <ActivityIndicator color={colors.onInk} /> : <Ionicons name={hasText ? 'chevron-forward' : 'close'} size={24} color={colors.onInk} />}
      </Pressable>
    </View>}
    {renderSheets()}
  </KeyboardAvoidingView>;

  function renderSheets() {
    return <>
      <Sheet visible={sheet === 'details'} onClose={() => setSheet(null)}>
        <View style={styles.group}>
          <Row label="Tags" value={tags.length ? tags.map((t) => `#${t}`).join(' ') : 'Add tags'} onPress={() => setSheet('tags')} />
          <DateRow day={day} onChange={setDay} />
          <View style={[styles.row, styles.rowLast]}>
            <AppText style={{ flex: 1, fontSize: 17 }}>Larger text</AppText>
            <Switch value={prefs.journalLargeText} onValueChange={(v) => void updatePrefs({ journalLargeText: v })} trackColor={{ true: colors.teal, false: colors.borderStrong }} thumbColor="#FFFFFF" accessibilityLabel="Larger text" />
          </View>
        </View>
        <View style={styles.stats}>
          <Stat value={String(words)} label={words === 1 ? 'word' : 'words'} />
          <Stat value={String(plain.length)} label="characters" />
          <Stat value={humanDuration(sessionSeconds)} label="this session length" />
          <Stat value={humanDuration(savedSeconds + sessionSeconds)} label="total writing time" />
          <Stat value={humanDuration(Math.round((words / 230) * 60))} label="reading length" />
        </View>
        {entryId || hasText ? <Button label="Delete this entry" icon="trash-outline" variant="outline" onPress={confirmDelete} style={{ alignSelf: 'center', marginTop: 8, minWidth: 220 }} /> : null}
      </Sheet>
      <Sheet visible={sheet === 'tags'} onClose={() => { setSheet(null); if (entryId && mode === 'read') void saveEntry(db, { id: entryId, dateKey: day, body, prompt, tags }).then(invalidate); }} title="Tags">
        <TagEditor tags={tags} onChange={setTags} />
      </Sheet>
      <Sheet visible={sheet === 'prompts'} onClose={() => setSheet(null)} title="Journaling suggestions">
        <View style={styles.group}>
          {[promptForDay(todayKey()), ...morePrompts(todayKey(), 10)].map((p, i, all) => (
            <Pressable key={p} onPress={() => { setPrompt(p); setSheet(null); setTimeout(() => input.current?.focus(), 300); }} accessibilityRole="button"
              style={({ pressed }) => [styles.row, i === all.length - 1 && styles.rowLast, pressed && { backgroundColor: colors.bg }]}>
              <AppText style={{ flex: 1, fontSize: 17, lineHeight: 24 }}>{p}</AppText>
              {i === 0 ? <AppText variant="micro" muted>TODAY</AppText> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>;
  }
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.bg }]}>
    <Ionicons name={icon} size={23} color={colors.text} />
    <AppText style={{ fontSize: 18 }}>{label}</AppText>
  </Pressable>;
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={[styles.sheet, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 12 }]}>
      <View style={styles.sheetHeader}>
        {title ? <AppText variant="title" style={{ flex: 1 }}>{title}</AppText> : <View style={{ flex: 1 }} />}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ gap: 20, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  </Modal>;
}

function Row({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]}>
    <AppText style={{ fontSize: 17 }}>{label}</AppText>
    <View style={{ flex: 1 }} />
    <AppText variant="bodyStrong" numberOfLines={1} style={{ fontSize: 17, flexShrink: 1 }}>{value}</AppText>
    <Ionicons name="chevron-forward" size={20} color={colors.text} />
  </Pressable>;
}

function DateRow({ day, onChange }: { day: string; onChange: (k: string) => void }) {
  const { dark } = useTheme();
  const [open, setOpen] = useState(false);
  const label = parseDateKey(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const pick = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: parseDateKey(day), mode: 'date', maximumDate: new Date(), onChange: (e, d) => { if (e.type === 'set' && d) onChange(toDateKey(d)); } });
    } else setOpen((o) => !o);
  };
  return <>
    <Row label="Date" value={label} onPress={pick} />
    {open && Platform.OS === 'ios' ? <DateTimePicker value={parseDateKey(day)} mode="date" display="inline" maximumDate={new Date()} onChange={(_, d) => d && onChange(toDateKey(d))} themeVariant={dark ? 'dark' : 'light'} /> : null}
  </>;
}

function Stat({ value, label }: { value: string; label: string }) {
  const styles = useStyles(makeStyles);
  return <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
    <AppText variant="bodyStrong" style={{ fontSize: 18 }}>{value}</AppText>
    <AppText muted>{label}</AppText>
  </View>;
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [draft, setDraft] = useState('');
  const add = (t: string) => { onChange(parseTags([...tags, t].join(','))); setDraft(''); };
  const toggle = (t: string) => (tags.includes(t) ? onChange(tags.filter((x) => x !== t)) : add(t));
  return <View style={{ gap: 16 }}>
    <View style={styles.tagInputRow}>
      <AppText variant="heading" muted>#</AppText>
      <TextInput value={draft} onChangeText={setDraft} placeholder="Add a tag" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false}
        onSubmitEditing={() => draft.trim() && add(draft)} returnKeyType="done" style={styles.tagInput} accessibilityLabel="New tag" maxLength={24} />
      {draft.trim() ? <Button label="Add" small onPress={() => add(draft)} /> : null}
    </View>
    <View style={styles.tagWrap}>
      {[...new Set([...tags, ...SUGGESTED_TAGS])].map((t) => {
        const on = tags.includes(t);
        return <Pressable key={t} onPress={() => toggle(t)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.tagChip, on && { backgroundColor: colors.ink }]}>
          <AppText variant="bodyStrong" color={on ? colors.onInk : colors.text}>{`#${t}`}</AppText>
        </Pressable>;
      })}
    </View>
  </View>;
}

function humanDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} ${r === 1 ? 'sec' : 'secs'}`;
  return `${m} min${r ? `, ${r} ${r === 1 ? 'sec' : 'secs'}` : ''}`;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 6 },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 48, paddingHorizontal: 18, borderRadius: 999, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong, ...t.shadow.card },
  round: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong },
  done: { backgroundColor: c.ink, borderColor: c.ink, borderRadius: 18, ...t.shadow.float },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: c.surfaceAlt },
  editContent: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 40, flexGrow: 1 },
  readContent: { paddingHorizontal: 22, paddingTop: 8 },
  promptRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  input: { minHeight: 280, padding: 0, color: c.text },
  placeholder: { fontFamily: fonts.italic, fontSize: 28, lineHeight: 36 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  deeper: { height: 52, paddingHorizontal: 18, borderRadius: 18, justifyContent: 'center', backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong },
  popover: { position: 'absolute', left: 16, width: 290, paddingVertical: 10, borderRadius: 32, backgroundColor: c.surface, ...t.shadow.float },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 22, minHeight: 54 },
  formatPanel: { backgroundColor: c.surfaceAlt, borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  formatRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  segment: { flexDirection: 'row', flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: c.bg },
  segBtn: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
  segDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.borderStrong },
  segLabel: { fontSize: 22, lineHeight: 28 },
  quoteBtn: { width: 64, height: 52, borderRadius: 14, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  blockBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12 },
  sheet: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  group: { backgroundColor: c.surface, borderRadius: radii.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderStrong },
  rowLast: { borderBottomWidth: 0 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexBasis: '47%', flexGrow: 1, padding: 18, borderRadius: 20, backgroundColor: c.surfaceAlt, gap: 2 },
  tagInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: radii.lg, paddingHorizontal: 18, minHeight: 60 },
  tagInput: { flex: 1, fontFamily: fonts.body, fontSize: 18, color: c.text, paddingVertical: 12 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tagChip: { paddingHorizontal: 16, minHeight: 42, justifyContent: 'center', borderRadius: 999, backgroundColor: c.surfaceAlt },
});
