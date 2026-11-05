/**
 * Charts for the Trends screen: a smooth full-bleed mood line, mood breakdown bars with Wren's
 * mood owls, tile calendars, concentric emotion rings and a word cloud.
 * Every chart renders only real values; empty inputs fall back to <NoData />.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { Owl } from '@/components/ui/Owl';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { moodColors, type Palette } from '@/theme/tokens';

function useWidth(initial = 320): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.max(120, Math.round(e.nativeEvent.layout.width)))];
}

type Pt = { x: number; y: number };

/** Catmull-Rom spline through the points as cubic Béziers (tension 0.5 keeps curves inside the data range). */
function smoothPath(pts: Pt[]): string {
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.5 / 3;
    const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t };
    const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Splits a series at nulls into runs of consecutive points. */
function runs(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ x: x(i), y: y(v) });
  });
  if (cur.length) out.push(cur);
  return out;
}

export const TrendLine = memo(function TrendLine({
  values,
  previous,
  labels,
  currentIndex = -1,
  domain = [1, 5],
  average,
  height = 200,
  color: colorProp,
}: {
  values: (number | null)[];
  previous?: (number | null)[];
  labels: string[];
  currentIndex?: number;
  domain?: [number, number];
  average?: number | null;
  height?: number;
  color?: string;
}) {
  const { colors, dark } = useTheme();
  const color = colorProp ?? colors.sky;
  const prevColor = dark ? colors.borderStrong : '#DCDEE2';
  const [w, onLayout] = useWidth();
  const padX = 18;
  const top = 14;
  const bottom = 14;
  const n = Math.max(values.length, 2);
  const x = (i: number) => padX + (i * (w - padX * 2)) / (n - 1);
  const y = (v: number) => top + (1 - (v - domain[0]) / (domain[1] - domain[0])) * (height - top - bottom);
  const prevRuns = previous ? runs(previous, x, y) : [];
  const curRuns = runs(values, x, y);
  return (
    <View onLayout={onLayout} accessible accessibilityLabel={`Trend chart. ${values.filter((v) => v !== null).length} periods with data.`}>
      <Svg width={w} height={height}>
        {average !== null && average !== undefined ? (
          <Line x1={0} x2={w} y1={y(average)} y2={y(average)} stroke={colors.borderStrong} strokeWidth={1} />
        ) : null}
        {prevRuns.map((r, i) =>
          r.length === 1 ? <Circle key={`p${i}`} cx={r[0].x} cy={r[0].y} r={4} fill={prevColor} /> : <Path key={`p${i}`} d={smoothPath(r)} stroke={prevColor} strokeWidth={6} fill="none" strokeLinecap="round" />,
        )}
        {curRuns.map((r, i) =>
          r.length === 1 ? <Circle key={`c${i}`} cx={r[0].x} cy={r[0].y} r={5} fill={color} /> : <Path key={`c${i}`} d={smoothPath(r)} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" />,
        )}
      </Svg>
      {average !== null && average !== undefined ? (
        <AppText variant="caption" style={[styles.avgLabel, { top: y(average) + 4 }]} color={dark ? colors.textMuted : colors.borderStrong}>
          Average
        </AppText>
      ) : null}
      <View style={[styles.axis, { paddingHorizontal: padX - 8 }]}>
        {labels.map((l, i) => (
          <AppText key={i} variant="bodyStrong" color={i === currentIndex ? colors.text : colors.textMuted} style={[styles.axisLabel, i === currentIndex && { fontFamily: 'FigtreeBold' }]}>
            {l}
          </AppText>
        ))}
      </View>
    </View>
  );
});

/** Face for a 1–5 mood: a single mouth line from frown to smile, as in the reference. */
export function MoodFace({ mood, size = 48 }: { mood: number; size?: number }) {
  const curve = [-9, -5, 0, 5, 9][mood - 1] ?? 0;
  const { colors } = useTheme();
  const r = size / 2;
  const w = size * 0.32;
  const yMid = r + size * 0.06;
  return (
    <Svg width={size} height={size} accessible={false}>
      <Circle cx={r} cy={r} r={r} fill={colors.surfaceAlt} />
      <Path d={`M${r - w / 2},${yMid - curve * 0.15 * (size / 48)} Q${r},${yMid + curve * (size / 48)} ${r + w / 2},${yMid - curve * 0.15 * (size / 48)}`} stroke={colors.text} strokeWidth={2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function MoodBreakdown({ current, previous, currentLabel, previousLabel }: { current: number[]; previous: number[]; currentLabel: string; previousLabel: string }) {
  const { colors, dark } = useTheme();
  const empty = dark ? colors.borderStrong : '#E6E7EA';
  const max = Math.max(1, ...current, ...previous);
  const H = 170;
  return (
    <View>
      <View style={styles.breakdown}>
        {[1, 2, 3, 4, 5].map((m, i) => (
          <View key={m} style={styles.breakdownCol} accessible accessibilityLabel={`Mood ${m}: ${current[i]} ${currentLabel.toLowerCase()}, ${previous[i]} ${previousLabel.toLowerCase()}`}>
            <View style={[styles.bars, { height: H }]}>
              <View style={[styles.bar, { height: Math.max(6, (previous[i] / max) * H), backgroundColor: empty }]} />
              <View style={[styles.bar, { height: Math.max(6, (current[i] / max) * H), backgroundColor: current[i] ? moodColors[i] : empty }]} />
            </View>
            <Owl mood={m} size={44} />
          </View>
        ))}
      </View>
      <Legend items={[{ color: colors.sky, label: currentLabel }, { color: dark ? colors.borderStrong : '#D3D5D9', label: previousLabel }]} />
    </View>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: it.color }]} />
          <AppText variant="bodyStrong" secondary>
            {it.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export type DotCell = { label: string; kind: 'empty' } | { label: string; kind: 'check' } | { label: string; kind: 'mood'; color: string; scale: number };

/** Grid of rounded tiles: empty, done (mint with a tick) or a mood tile whose fill shows how often you checked in. */
export function DotGrid({ cells, columns = 6, size = 44 }: { cells: DotCell[]; columns?: number; size?: number }) {
  const { colors } = useTheme();
  const themed = useStyles(makeStyles);
  return (
    <View style={styles.dotGrid}>
      {cells.map((c, i) => (
        <View key={i} style={[styles.dotCell, { width: `${100 / columns}%` }]} accessible accessibilityLabel={`${c.label}: ${c.kind === 'empty' ? 'nothing' : c.kind === 'check' ? 'yes' : 'mood logged'}`}>
          <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            {c.kind === 'empty' ? (
              <View style={[themed.ring, { width: size - 4, height: size - 4, borderRadius: size * 0.3 }]} />
            ) : c.kind === 'check' ? (
              <View style={[themed.check, { width: size - 2, height: size - 2, borderRadius: size * 0.3 }]}>
                <Ionicons name="checkmark" size={size * 0.45} color={colors.textOnAccent} />
              </View>
            ) : (
              <View style={{ width: size - 2, height: size - 2, borderRadius: size * 0.3, backgroundColor: `${c.color}33`, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
                <View style={{ width: '100%', height: `${Math.round(Math.max(0.25, c.scale) * 100)}%`, backgroundColor: c.color }} />
              </View>
            )}
          </View>
          {c.label ? (
            <AppText variant="bodyStrong" muted style={{ fontSize: 15 }}>
              {c.label}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Concentric arcs, one per emotion, with a legend. */
export function EmotionRings({ items }: { items: { label: string; share: number; color: string }[] }) {
  const { colors } = useTheme();
  const size = 150;
  const c = size / 2;
  const radii = [64, 50, 36];
  return (
    <View style={styles.rings}>
      <Svg width={size} height={size} accessible={false}>
        <Circle cx={c} cy={c} r={radii[0] + 8} fill={colors.bg} />
        {items.slice(0, 3).map((it, i) => {
          const r = radii[i];
          const circ = 2 * Math.PI * r;
          const len = Math.max(0.04, Math.min(1, it.share)) * circ;
          return (
            <Circle key={it.label} cx={c} cy={c} r={r} stroke={it.color} strokeWidth={8} fill="none" strokeDasharray={`${len} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${c} ${c})`} />
          );
        })}
      </Svg>
      <View style={{ flex: 1, gap: 12 }}>
        {items.slice(0, 3).map((it) => (
          <View key={it.label} style={styles.ringRow} accessible accessibilityLabel={`${it.label}, ${Math.round(it.share * 100)} percent`}>
            <View style={[styles.legendDot, { width: 18, height: 18, borderRadius: 9, backgroundColor: it.color }]} />
            <AppText variant="bodyStrong" style={{ flex: 1, fontSize: 17 }} numberOfLines={1}>
              {it.label}
            </AppText>
            <AppText variant="bodyStrong" style={{ fontSize: 17 }} color={it.color}>
              {`${Math.round(it.share * 100)}%`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

export function WordCloud({ words }: { words: { word: string; count: number }[] }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...words.map((w) => w.count));
  const palette = [colors.text, colors.primary, colors.textSecondary, colors.sky];
  return (
    <View style={styles.cloud} accessible accessibilityLabel={`Most used words: ${words.slice(0, 8).map((w) => w.word).join(', ')}`}>
      {words.map((w, i) => {
        const size = 14 + Math.round((w.count / max) * 18);
        return (
          <AppText key={w.word} variant="bodyStrong" color={palette[i % palette.length]} style={{ fontSize: size, lineHeight: size + 6, fontFamily: w.count === max ? 'FigtreeBold' : 'FigtreeSemiBold' }}>
            {w.word}
          </AppText>
        );
      })}
    </View>
  );
}

export function NoData({ title = 'No data yet', body }: { title?: string; body: string }) {
  return (
    <View style={styles.noData}>
      <AppText variant="bodyStrong" muted align="center" style={{ fontSize: 18 }}>
        {title}
      </AppText>
      <AppText muted align="center" style={{ maxWidth: 280 }}>
        {body}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  axisLabel: { width: 16, textAlign: 'center', fontSize: 14 },
  avgLabel: { position: 'absolute', right: 8, fontFamily: 'FigtreeSemiBold' },
  breakdown: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 4 },
  breakdownCol: { alignItems: 'center', gap: 10, flex: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bar: { width: 9, borderRadius: 5 },
  legend: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 24, marginTop: 22 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  dotGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  dotCell: { alignItems: 'center', gap: 6 },
  rings: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cloud: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: 12, rowGap: 2, paddingVertical: 8 },
  noData: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 36, minHeight: 160 },
});
const makeStyles = (c: Palette) => StyleSheet.create({
  ring: { borderWidth: 1.5, borderColor: c.borderStrong, backgroundColor: c.bg },
  check: { backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },
});
