import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/misc';
import { SourceTag } from '@/components/ui/SourceTag';
import { emotionMeta, isHeavy, type JournalAnalysis } from '@/features/journal/analysis';
import { emotionColor, INTENSITY_WORDS } from '@/features/journal/journalService';
import { CRISIS_MESSAGE } from '@/features/coach/safety';
import { AI_ENABLED, friendlyModelName } from '@/services/ai/llm';
import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { radii, type Palette } from '@/theme/tokens';

/** What the analysis found in one entry, with gentle next steps when it reads heavy. */
export function EntryReading({ analysis, analyzing, aiError, onAskAi }: {
  analysis: JournalAnalysis | null;
  analyzing: boolean;
  aiError?: string | null;
  onAskAi?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  if (analyzing) {
    return <View style={[styles.card, styles.row]}>
      <ActivityIndicator color={colors.text} />
      <AppText secondary style={{ flex: 1 }}>Reading the feelings in your entry…</AppText>
    </View>;
  }
  if (!analysis) return null;
  const empty = analysis.emotions.length === 0 && analysis.sentiment === 0;
  const heavy = isHeavy(analysis);
  const lifts = analysis.triggers.filter((t) => t.valence === 'positive');
  const weighs = analysis.triggers.filter((t) => t.valence === 'negative');
  const marker = (analysis.sentiment + 1) / 2;
  return <View style={{ gap: 14 }}>
    {analysis.distress === 'urgent' ? <View style={[styles.card, { borderWidth: 1.5, borderColor: colors.rose, gap: 10 }]}>
      <AppText variant="bodyStrong" color={colors.rose}>You don’t have to handle this alone</AppText>
      <AppText variant="caption" secondary>{CRISIS_MESSAGE}</AppText>
      <Button label="See support options" small onPress={() => router.push('/support')} />
    </View> : null}

    <View style={[styles.card, { gap: 16 }]}>
      <View style={styles.row}>
        <Ionicons name="sparkles" size={18} color={colors.text} />
        <AppText variant="bodyStrong" style={{ flex: 1, fontSize: 18 }}>How this entry reads</AppText>
      </View>
      {empty ? <AppText secondary>Not enough to read yet. A few more sentences help.</AppText> : <>
        <View style={styles.chips}>
          {analysis.emotions.map((e) => <View key={e.name} style={styles.chip} accessibilityLabel={`${INTENSITY_WORDS[e.intensity]} ${emotionMeta(e.name).label}`}>
            <View style={[styles.dot, { backgroundColor: emotionColor(e.name) }]} />
            <AppText variant="bodyStrong">{emotionMeta(e.name).label}</AppText>
            <AppText variant="caption" muted>{INTENSITY_WORDS[e.intensity]}</AppText>
          </View>)}
        </View>
        <View style={{ gap: 6 }} accessible accessibilityLabel={`Overall tone ${analysis.sentiment < -0.2 ? 'heavy' : analysis.sentiment > 0.2 ? 'light' : 'mixed'}`}>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { left: `${Math.min(96, Math.max(0, marker * 100 - 2))}%`, backgroundColor: analysis.sentiment < -0.2 ? colors.rose : analysis.sentiment > 0.2 ? colors.sky : colors.textMuted }]} />
          </View>
          <View style={styles.meterLabels}><AppText variant="micro" muted>HEAVY</AppText><AppText variant="micro" muted>MIXED</AppText><AppText variant="micro" muted>LIGHT</AppText></View>
        </View>
        {lifts.length ? <Line icon="sunny-outline" label="Lifting you" items={lifts.map((t) => t.phrase)} /> : null}
        {weighs.length ? <Line icon="cloud-outline" label="Weighing on you" items={weighs.map((t) => t.phrase)} /> : null}
        {analysis.reflection ? <View style={styles.reflection}><AppText style={{ fontSize: 17, lineHeight: 25 }}>{analysis.reflection}</AppText></View> : null}
      </>}
      <View style={styles.row}>
        <SourceTag source={analysis.source === 'ai' ? 'ai' : 'experimental'} label={analysis.source === 'ai' ? `AI reading · ${friendlyModelName(analysis.model)}` : 'On-device keyword estimate'} />
      </View>
      {aiError ? <Notice tone="warn">{aiError}</Notice> : null}
      {analysis.source === 'local' && AI_ENABLED && onAskAi ? <Button label="Ask Wren to read it" icon="sparkles-outline" small variant="secondary" onPress={onAskAi} style={{ alignSelf: 'flex-start' }} /> : null}
      <AppText variant="caption" muted>A reading of your words, not a diagnosis. You know how you feel best.</AppText>
    </View>

    {heavy && analysis.distress !== 'urgent' ? <View style={[styles.card, { gap: 12 }]}>
      <AppText variant="bodyStrong" style={{ fontSize: 18 }}>This sounds like a heavy moment</AppText>
      <AppText variant="caption" secondary>{analysis.distress === 'concern' ? 'Some of what you wrote sounds really hard. If it keeps feeling this way, talking to someone you trust or a counsellor can help.' : 'Be gentle with yourself. One of these might help a little.'}</AppText>
      <View style={styles.actions}>
        <Button label="Slow breathing" icon="leaf-outline" small onPress={() => router.push('/breathing')} />
        {AI_ENABLED ? <Button label="Talk to Wren" icon="chatbubble-ellipses-outline" small variant="secondary" onPress={() => router.navigate('/coach')} /> : null}
        <Button label="Support" icon="heart-outline" small variant="secondary" onPress={() => router.push('/support')} />
      </View>
    </View> : null}
  </View>;
}

function Line({ icon, label, items }: { icon: keyof typeof Ionicons.glyphMap; label: string; items: string[] }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return <View style={styles.row}>
    <Ionicons name={icon} size={18} color={colors.textSecondary} />
    <AppText variant="caption" secondary style={{ width: 118 }}>{label}</AppText>
    <AppText variant="bodyStrong" style={{ flex: 1 }}>{items.join(', ')}</AppText>
  </View>;
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: radii.lg, padding: 20, ...t.shadow.card, borderWidth: t.dark ? StyleSheet.hairlineWidth : 0, borderColor: c.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, minHeight: 40, borderRadius: 999, backgroundColor: c.bg },
  dot: { width: 12, height: 12, borderRadius: 6 },
  meter: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt },
  meterFill: { position: 'absolute', top: -3, width: 14, height: 14, borderRadius: 7 },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  reflection: { borderLeftWidth: 3, borderLeftColor: c.sky, paddingLeft: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
