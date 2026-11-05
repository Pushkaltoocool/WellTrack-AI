/**
 * Lightweight SVG charts (react-native-svg, bundled with Expo Go).
 * All charts measure their own width so they adapt to any phone size.
 */
import { memo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { spacing, type Palette } from '@/theme/tokens';

function useWidth(initial = 300): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.max(100, Math.round(e.nativeEvent.layout.width)))];
}

const AXIS_W = 30;
const LABEL_H = 18;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export interface BarDatum {
  label: string;
  segments: { value: number; color: string }[];
}

export const BarChart = memo(function BarChart({
  data,
  height = 160,
  target,
  formatValue = (v: number) => `${Math.round(v)}`,
  labelEvery = 1,
}: {
  data: BarDatum[];
  height?: number;
  target?: number;
  formatValue?: (v: number) => string;
  labelEvery?: number;
}) {
  const { colors } = useTheme();
  const [width, onLayout] = useWidth();
  const totals = data.map((d) => d.segments.reduce((a, s) => a + s.value, 0));
  const max = niceMax(Math.max(...totals, target ?? 0));
  const plotW = width - AXIS_W;
  const plotH = height - LABEL_H;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(26, slot * 0.62));
  const y = (v: number) => plotH - (v / max) * (plotH - 6);
  // small ranges need a decimal so the 0 / mid / max ticks stay distinct
  const tick = (v: number) => (max < 3 ? `${Math.round(v * 10) / 10}` : formatValue(v));

  return (
    <View onLayout={onLayout} accessibilityRole="image" accessibilityLabel={`Bar chart, maximum ${formatValue(Math.max(...totals))}`}>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((f) => (
          <Line key={f} x1={AXIS_W} x2={width} y1={y(max * f)} y2={y(max * f)} stroke={colors.border} strokeDasharray="3 5" strokeWidth={1} />
        ))}
        {[0, 0.5, 1].map((f) => (
          <SvgText key={`t${f}`} x={AXIS_W - 6} y={y(max * f) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
            {tick(max * f)}
          </SvgText>
        ))}
        {target !== undefined && target > 0 ? (
          <Line x1={AXIS_W} x2={width} y1={y(target)} y2={y(target)} stroke={colors.teal} strokeWidth={1.5} strokeDasharray="6 4" />
        ) : null}
        {data.map((d, i) => {
          const x = AXIS_W + i * slot + (slot - barW) / 2;
          let acc = 0;
          return (
            <G key={`${d.label}-${i}`}>
              {d.segments.map((s, j) => {
                if (s.value <= 0) return null;
                const top = y(acc + s.value);
                const h = y(acc) - top;
                acc += s.value;
                return <Rect key={j} x={x} y={top} width={barW} height={Math.max(1, h)} rx={Math.min(4, barW / 3)} fill={s.color} />;
              })}
              {totals[i] === 0 ? <Rect x={x} y={plotH - 2} width={barW} height={2} rx={1} fill={colors.surfaceAlt} /> : null}
              {i % labelEvery === 0 || i === data.length - 1 ? (
                <SvgText x={x + barW / 2} y={height - 4} fontSize={10} fill={colors.textMuted} textAnchor="middle">
                  {d.label}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>
    </View>
  );
});

export interface LinePoint {
  label: string;
  value: number | null;
}

export const LineChart = memo(function LineChart({
  data,
  height = 150,
  color: colorProp,
  domain,
  formatValue = (v: number) => `${Math.round(v * 10) / 10}`,
  labelEvery = 1,
  target,
}: {
  data: LinePoint[];
  height?: number;
  color?: string;
  domain?: [number, number];
  formatValue?: (v: number) => string;
  labelEvery?: number;
  target?: number;
}) {
  const { colors } = useTheme();
  const color = colorProp ?? colors.cyan;
  const [width, onLayout] = useWidth();
  const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
  const lo = domain ? domain[0] : 0;
  const hi = domain ? domain[1] : niceMax(Math.max(...vals, target ?? 0, 1));
  const plotW = width - AXIS_W - 30;
  const plotH = height - LABEL_H;
  const x = (i: number) => AXIS_W + 14 + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (plotH - 12);

  // Split into contiguous runs so missing days show as gaps rather than invented values.
  const runs: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push({ i, v: d.value });
  });
  if (cur.length) runs.push(cur);
  const gradId = `lg-${color.replace('#', '')}`;

  return (
    <View onLayout={onLayout} accessibilityRole="image" accessibilityLabel={`Line chart with ${vals.length} data points`}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0, 0.5, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <G key={f}>
              <Line x1={AXIS_W} x2={width} y1={y(v)} y2={y(v)} stroke={colors.border} strokeDasharray="3 5" />
              <SvgText x={AXIS_W - 6} y={y(v) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
                {formatValue(v)}
              </SvgText>
            </G>
          );
        })}
        {target !== undefined ? (
          <Line x1={AXIS_W} x2={width} y1={y(target)} y2={y(target)} stroke={colors.teal} strokeWidth={1.5} strokeDasharray="6 4" />
        ) : null}
        {runs.map((run, k) => {
          const d = run.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
          const area =
            run.length > 1
              ? `${d} L${x(run[run.length - 1].i).toFixed(1)},${plotH} L${x(run[0].i).toFixed(1)},${plotH} Z`
              : '';
          return (
            <G key={k}>
              {area ? <Path d={area} fill={`url(#${gradId})`} /> : null}
              <Path d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </G>
          );
        })}
        {data.map((p, i) =>
          p.value === null ? null : (
            <Circle key={i} cx={x(i)} cy={y(p.value)} r={data.length > 14 ? 2.5 : 4} fill={colors.bg} stroke={color} strokeWidth={2} />
          ),
        )}
        {data.map((p, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <SvgText key={`l${i}`} x={x(i)} y={height - 4} fontSize={10} fill={colors.textMuted} textAnchor="middle">
              {p.label}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
});

/** Real-time multi-axis signal plot for the live tracking screen. */
export const LiveSignalChart = memo(function LiveSignalChart({
  series,
  colorsList: colorsListProp,
  height = 110,
  range,
}: {
  series: number[][];
  colorsList?: string[];
  height?: number;
  /** Symmetric +/- range; auto-scaled from data when omitted. */
  range?: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const colorsList = colorsListProp ?? [colors.cyan, colors.violet, colors.teal];
  const [width, onLayout] = useWidth();
  const all = series.flat();
  const r = range ?? Math.max(0.5, ...all.map((v) => Math.abs(v))) * 1.1;
  const n = Math.max(2, ...series.map((s) => s.length));
  const x = (i: number) => (i / (n - 1)) * width;
  const y = (v: number) => height / 2 - (Math.max(-r, Math.min(r, v)) / r) * (height / 2 - 4);
  return (
    <View onLayout={onLayout} style={styles.live}>
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke={colors.border} strokeDasharray="2 4" />
        {series.map((s, k) =>
          s.length > 1 ? (
            <Path
              key={k}
              d={s.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
              stroke={colorsList[k % colorsList.length]}
              strokeWidth={1.8}
              fill="none"
              strokeLinejoin="round"
            />
          ) : null,
        )}
        <SvgText x={4} y={12} fontSize={9} fill={colors.textMuted}>
          {`±${r.toFixed(1)}`}
        </SvgText>
      </Svg>
    </View>
  );
});

/** Horizontal stacked proportion bar with a legend (activity breakdown). */
export function BreakdownBar({
  items,
  formatValue,
}: {
  items: { key: string; label: string; value: number; color: string }[];
  formatValue: (v: number) => string;
}) {
  const styles = useStyles(makeStyles);
  const total = items.reduce((a, i) => a + i.value, 0);
  const visible = items.filter((i) => i.value > 0);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.breakdownTrack}>
        {visible.map((i) => (
          <View key={i.key} style={{ flex: i.value / total, backgroundColor: i.color }} />
        ))}
      </View>
      <View style={styles.legend}>
        {items.map((i) => (
          <View key={i.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: i.color }]} />
            <AppText variant="caption" secondary style={{ flex: 1 }} numberOfLines={1}>
              {i.label}
            </AppText>
            <AppText variant="caption">{formatValue(i.value)}</AppText>
            <AppText variant="caption" muted style={{ width: 38, textAlign: 'right' }}>
              {total > 0 ? `${Math.round((i.value / total) * 100)}%` : '–'}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  live: {
    backgroundColor: c.bgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  breakdownTrack: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: c.surfaceAlt,
    gap: 2,
  },
  legend: { gap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
});
