import { Fragment } from 'react';
import { Text, type TextStyle } from 'react-native';

import { parseDocument, type Block, type Span } from '@/features/journal/markdown';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, type Palette } from '@/theme/tokens';

export const BLOCK_STYLES: Record<Block, TextStyle> = {
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 38, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.display, fontSize: 24, lineHeight: 31, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 27 },
  quote: { fontFamily: fonts.italic, fontSize: 20, lineHeight: 29 },
  body: { fontFamily: fonts.body, fontSize: 19, lineHeight: 29 },
};
const LARGE: TextStyle = { fontSize: 23, lineHeight: 34 };
/** Text colour for a block; `BLOCK_STYLES` stays colour-free so it works in both themes. */
export const blockColor = (block: Block, c: Palette) => (block === 'quote' ? c.textSecondary : c.text);

function spanStyle(s: Span, block: Block): TextStyle {
  const lines = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  return {
    ...(s.bold ? { fontFamily: fonts.bold } : null),
    ...(s.italic ? { fontFamily: block === 'title' || block === 'heading' ? fonts.bold : fonts.italic } : null),
    ...(lines ? { textDecorationLine: lines as TextStyle['textDecorationLine'] } : null),
  };
}

/**
 * Journal text with live formatting. `editing` keeps the formatting characters (faint) so the
 * rendered string matches the TextInput value exactly; reading hides them.
 */
export function JournalSpans({ text, editing, large }: { text: string; editing?: boolean; large?: boolean }) {
  const { colors } = useTheme();
  const lines = parseDocument(text);
  return (
    <>
      {lines.map((line, i) => {
        const base = [BLOCK_STYLES[line.block], { color: blockColor(line.block, colors) }, large && line.block === 'body' ? LARGE : null];
        return (
          <Fragment key={i}>
            {i > 0 ? <Text style={BLOCK_STYLES.body}>{'\n'}</Text> : null}
            {editing && line.prefix ? <Text style={[base, { color: colors.borderStrong }]}>{line.prefix}</Text> : null}
            {!editing && line.block === 'quote' ? <Text style={base}>{'│ '}</Text> : null}
            {line.spans.map((s, j) =>
              s.marker ? (
                editing ? <Text key={j} style={[base, { color: colors.borderStrong }]}>{s.text}</Text> : null
              ) : (
                <Text key={j} style={[base, spanStyle(s, line.block)]}>{s.text}</Text>
              ),
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export function JournalText({ text, numberOfLines }: { text: string; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} selectable={!numberOfLines}>
      <JournalSpans text={text} />
    </Text>
  );
}
