import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/misc';
import { Owl } from '@/components/ui/Owl';
import { RichText } from '@/components/ui/RichText';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { TAB_BAR_HEIGHT, tabBarBottom, useKeyboardVisible } from '@/components/ui/tabBarState';
import { sendCoachMessage, WEEKLY_PROMPT } from '@/features/coach/coachService';
import { CRISIS_MESSAGE, detectCrisis } from '@/features/coach/safety';
import { todayKey } from '@/lib/dates';
import { AI_ENABLED, AI_VIA_PROXY, friendlyModelName, LlmError } from '@/services/ai/llm';
import { useAccount } from '@/services/cloud/AccountProvider';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { clearCoachMessages, listCoachMessages } from '@/services/database/repositories';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { fonts, type Palette } from '@/theme/tokens';

const STARTERS = [
  'Help me plan a calmer evening',
  'Reflect on my week with me',
  'I have an exam soon. How should I prepare?',
  'Why might I be sleeping badly?',
];

export default function CoachScreen() {
  const { prefs } = useData();
  if (!AI_ENABLED) {
    return (
      <Screen title="Wren">
        <Notice tone="info" title="The AI coach isn’t available in this build">Everything else in WellTrack works without it.</Notice>
      </Screen>
    );
  }
  return prefs.coachConsentAt ? <Chat /> : <Consent />;
}

function Consent() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { prefs, updatePrefs } = useData();
  const [notes, setNotes] = useState(prefs.coachIncludeNotes);
  return (
    <Screen title="Meet Wren" subtitle="An AI coach that knows your recent check-ins, goals and exams, and helps you turn them into small next steps.">
      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <Owl mood={4} pose="calm" size={120} />
      </View>
      <View style={styles.stack}>
        <Card>
          <View style={{ gap: 10 }}>
            <AppText variant="bodyStrong">Before you start</AppText>
            <Bullet text="Wren is an AI language model. It can be wrong, and it is not a therapist, doctor or crisis service." />
            <Bullet text="To answer, your messages and a short summary of your last 14 days (sleep, study, mood, stress, goals, exams, steps and the feelings named in your journal, never the entries themselves) are sent to OpenRouter and the AI model provider. Raw motion data is never sent." />
            <Bullet text={AI_VIA_PROXY ? 'Requests go through WellTrack’s server, which does not keep your messages.' : 'WellTrack doesn’t keep your conversation on any server; it stays on this phone and in your backup.'} />
            <Bullet text="Don’t share anything you wouldn’t want a third-party service to process." />
          </View>
        </Card>
        <Card>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="bodyStrong">Include my check-in notes</AppText>
              <AppText variant="caption" secondary>Off by default. Lets Wren read the few words you write each day.</AppText>
            </View>
            <Switch value={notes} onValueChange={setNotes} trackColor={{ true: colors.teal, false: colors.borderStrong }} thumbColor="#FFFFFF" accessibilityLabel="Include check-in notes" />
          </View>
        </Card>
        <Button label="Agree and start" onPress={() => void updatePrefs({ coachConsentAt: Date.now(), coachIncludeNotes: notes })} />
        <Button label="Not now" variant="ghost" onPress={() => router.navigate('/home')} />
      </View>
    </Screen>
  );
}

function Bullet({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <AppText color={colors.teal}>•</AppText>
      <AppText variant="caption" secondary style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

function Chat() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, updatePrefs, invalidate } = useData();
  const { user } = useAccount();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [menu, setMenu] = useState(false);
  const keyboard = useKeyboardVisible();
  const { data: messages = [] } = useDbQuery((d) => listCoachMessages(d), []);

  const send = async (raw: string | null) => {
    const text = raw?.trim() ?? null;
    if ((raw !== null && !text) || sending) return;
    if (text !== null) setDraft('');
    setError(null);
    if (text && detectCrisis(text).level === 'urgent') setCrisis(true);
    setSending(true);
    try {
      const idToken = AI_VIA_PROXY && user ? await user.getIdToken() : null;
      await sendCoachMessage(db, prefs, todayKey(), text, { idToken });
    } catch (e) {
      setError(e instanceof LlmError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
      invalidate();
    }
  };

  // Deep link from Insights: /coach?prompt=weekly sends the weekly reflection once.
  const sentPrompt = useRef(false);
  useEffect(() => {
    if (params.prompt === 'weekly' && !sentPrompt.current) {
      sentPrompt.current = true;
      void send(WEEKLY_PROMPT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prompt]);

  const clear = () =>
    Alert.alert('Clear conversation?', 'Deletes your chat with Wren from this phone (and from your next backup).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearCoachMessages(db); invalidate(); setMenu(false); } },
    ]);

  const withdraw = () =>
    Alert.alert('Stop using Wren?', 'Wren won’t send anything until you agree again. Your past conversation stays unless you clear it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => void updatePrefs({ coachConsentAt: null }) },
    ]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Owl mood={4} pose="idle" size={40} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading" style={{ fontSize: 22 }}>Wren</AppText>
          <AppText variant="caption" muted>AI coach · not a medical service</AppText>
        </View>
        <Pressable onPress={() => setMenu((m) => !m)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Coach options">
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
        </Pressable>
      </View>
      {menu ? (
        <View style={styles.menu}>
          <View style={styles.switchRow}>
            <AppText variant="caption" style={{ flex: 1 }}>Share check-in notes with Wren</AppText>
            <Switch value={prefs.coachIncludeNotes} onValueChange={(v) => void updatePrefs({ coachIncludeNotes: v })} trackColor={{ true: colors.teal, false: colors.borderStrong }} thumbColor="#FFFFFF" accessibilityLabel="Share check-in notes" />
          </View>
          <Button label="Clear conversation" small variant="secondary" icon="trash-outline" onPress={clear} />
          <Button label="Stop using Wren" small variant="ghost" onPress={withdraw} />
        </View>
      ) : null}

      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled">
        {messages.length === 0 && !sending ? (
          <View style={{ gap: 14 }}>
            <AppText variant="title">{`Hi${prefs.displayName ? ` ${prefs.displayName}` : ''}. What’s on your mind?`}</AppText>
            <AppText secondary>I can see your recent check-ins, goals and exams. Ask for a plan, a reflection or a nudge.</AppText>
            <View style={styles.starters}>
              {STARTERS.map((s) => (
                <Pressable key={s} onPress={() => void send(s)} style={styles.starter} accessibilityRole="button">
                  <AppText variant="caption">{s}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {messages.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={[styles.bubble, styles.userBubble]}>
              <AppText color={colors.onInk}>{m.content}</AppText>
            </View>
          ) : (
            <View key={m.id} style={[styles.bubble, styles.botBubble]}>
              <RichText text={m.content} />
              <SourceTag source="ai" label={`AI-generated · ${friendlyModelName(m.model)}`} />
            </View>
          ),
        )}
        {crisis ? (
          <Card style={{ borderWidth: 1, borderColor: colors.rose }}>
            <View style={{ gap: 10 }}>
              <AppText variant="bodyStrong" color={colors.rose}>You don’t have to handle this alone</AppText>
              <AppText variant="caption" secondary>{CRISIS_MESSAGE}</AppText>
              <Button label="See support options" small onPress={() => router.push('/support')} />
            </View>
          </Card>
        ) : null}
        {sending ? (
          <View style={[styles.bubble, styles.botBubble, { flexDirection: 'row', gap: 10, alignItems: 'center' }]}>
            <ActivityIndicator color={colors.teal} />
            <AppText variant="caption" secondary>Wren is thinking…</AppText>
          </View>
        ) : null}
        {error ? (
          <View style={{ gap: 10 }}>
            <Notice tone="danger">{error}</Notice>
            {messages.at(-1)?.role === 'user' ? <Button label="Try again" small variant="secondary" icon="refresh" onPress={() => void send(null)} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: keyboard ? 12 : tabBarBottom(insets.bottom) + TAB_BAR_HEIGHT + 12 }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Wren"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          maxLength={1000}
          accessibilityLabel="Message Wren"
        />
        <Pressable
          onPress={() => void send(draft)}
          disabled={!draft.trim() || sending}
          style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityLabel="Send">
          <Ionicons name="arrow-up" size={22} color={colors.onInk} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  stack: { gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 10 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  menu: { padding: 16, gap: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  list: { padding: 20, gap: 12, flexGrow: 1 },
  starters: { gap: 10 },
  starter: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.borderStrong },
  bubble: { maxWidth: '88%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: c.ink, borderBottomRightRadius: 6 },
  botBubble: { alignSelf: 'stretch', maxWidth: '100%', backgroundColor: c.surface, borderBottomLeftRadius: 6 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: c.bg },
  input: { flex: 1, minHeight: 48, maxHeight: 140, borderRadius: 24, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, color: c.text, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 13, fontFamily: fonts.body, fontSize: 16 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
});
