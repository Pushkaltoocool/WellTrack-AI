/** Renders the small markdown subset LLM replies use: paragraphs, "-"/"*"/"1." bullets, **bold** and headings. */
import { StyleSheet, View } from 'react-native';

import { useStyles } from '@/theme/ThemeProvider';
import { fonts, type Palette } from '@/theme/tokens';

import { AppText } from './AppText';

function Inline({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <AppText style={styles.body}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <AppText key={i} style={[styles.body, styles.bold]}>{p.slice(2, -2)}</AppText>
        ) : (
          p.replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1$2').replace(/`/g, '')
        ),
      )}
    </AppText>
  );
}

export function RichText({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  const lines = text.replace(/\r/g, '').split('\n');
  return (
    <View style={styles.wrap}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (heading) return <AppText key={i} style={[styles.body, styles.bold]}>{heading[1].replace(/\*\*/g, '')}</AppText>;
        const bullet = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          const marker = /\d/.test(bullet[2]) ? bullet[2] : '•';
          return (
            <View key={i} style={[styles.bulletRow, bullet[1].length >= 2 && { paddingLeft: 16 }]}>
              <AppText style={[styles.body, styles.marker]}>{marker}</AppText>
              <View style={{ flex: 1 }}><Inline text={bullet[3]} /></View>
            </View>
          );
        }
        return <Inline key={i} text={line} />;
      })}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  wrap: { gap: 4 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: c.text },
  bold: { fontFamily: fonts.semibold, fontWeight: '600' },
  bulletRow: { flexDirection: 'row', gap: 8 },
  marker: { color: c.teal, minWidth: 14 },
});
