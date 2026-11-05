/** Small shared building blocks: section headers, stat tiles, progress, pills, empty states, segmented control. */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useStyles, useTheme, type Theme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';

import { AppText } from './AppText';
import { Button } from './Button';
import { GlassSurface, LIQUID_GLASS } from './Glass';
import { SourceTag, type DataSource } from './SourceTag';

export type IconName = keyof typeof Ionicons.glyphMap;

export function SectionHeader({
  title,
  quiet,
  subtitle,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  quiet?: boolean;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={{ flex: 1 }}>
        <AppText variant={quiet ? 'caption' : 'heading'} secondary={quiet} accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" muted>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <AppText variant="caption" color={colors.primary}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function IconBadge({ icon, color, size = 36 }: { icon: IconName; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 3,
        backgroundColor: `${color}22`,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Ionicons name={icon} size={size * 0.5} color={color} />
    </View>
  );
}

export function StatTile({
  icon,
  color,
  label,
  value,
  unit,
  caption,
  source,
  style,
  onPress,
}: {
  icon: IconName;
  color: string;
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  source?: DataSource;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const content = (
    <>
      <View style={styles.statTop}>
        <IconBadge icon={icon} color={color} size={32} />
        <AppText variant="caption" secondary style={{ flex: 1 }} numberOfLines={2}>
          {label}
        </AppText>
      </View>
      <View style={styles.statValueRow}>
        <AppText variant="metric">{value}</AppText>
        {unit ? (
          <AppText variant="caption" secondary style={{ marginBottom: 4 }}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {caption ? (
        <AppText variant="caption" muted numberOfLines={2}>
          {caption}
        </AppText>
      ) : null}
      {source ? <View style={{ marginTop: spacing.sm }}><SourceTag source={source} /></View> : null}
    </>
  );
  const a11yLabel = `${label}: ${value} ${unit ?? ''}`;
  if (LIQUID_GLASS) {
    return (
      <GlassSurface interactive={!!onPress} style={[styles.statGlass, style]}>
        {onPress ? (
          <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11yLabel} style={styles.statInner}>
            {content}
          </Pressable>
        ) : (
          <View style={styles.statInner} accessibilityLabel={a11yLabel}>
            {content}
          </View>
        )}
      </GlassSurface>
    );
  }
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [styles.statTile, pressed && { opacity: 0.85 }, style]}>
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.statTile, style]} accessibilityLabel={a11yLabel}>
      {content}
    </View>
  );
}

export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      style={[styles.track, { height, borderRadius: height }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: color ?? colors.primary }} />
    </View>
  );
}

export function ProgressRing({
  value,
  size = 96,
  stroke = 10,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? colors.cyan}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function Pill({ label, color, icon }: { label: string; color: string; icon?: IconName }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.pill, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <AppText variant="caption" color={color}>
        {label}
      </AppText>
    </View>
  );
}

export function StatusDot({ status }: { status: 'ok' | 'warn' | 'error' | 'off' }) {
  const { colors } = useTheme();
  const c = { ok: colors.teal, warn: colors.amber, error: colors.rose, off: colors.textMuted }[status];
  return <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c }} />;
}

export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  compact,
}: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.empty, compact && { paddingVertical: spacing.lg }]}>
      <IconBadge icon={icon} color={colors.primary} size={compact ? 40 : 52} />
      <AppText variant="bodyStrong" align="center">
        {title}
      </AppText>
      <AppText variant="caption" secondary align="center" style={{ maxWidth: 300 }}>
        {body}
      </AppText>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} small variant="secondary" style={{ marginTop: spacing.xs }} />
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <GlassSurface style={LIQUID_GLASS ? styles.segmentedGlass : undefined} fallbackStyle={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              active && (LIQUID_GLASS ? styles.segmentActiveGlass : styles.segmentActive),
            ]}>
            <AppText variant="caption" color={active ? colors.text : colors.textMuted}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </GlassSurface>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.kv}>
      <AppText variant="caption" muted style={{ flex: 1 }}>
        {k}
      </AppText>
      <AppText variant={mono ? 'mono' : 'caption'} style={{ flex: 1.4, textAlign: 'right' }} selectable>
        {v}
      </AppText>
    </View>
  );
}

export function Notice({
  tone = 'info',
  icon,
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ml';
  icon?: IconName;
  title?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const c = { info: colors.primary, warn: colors.amber, danger: colors.rose, ml: colors.violet }[tone];
  const ic: IconName = icon ?? (tone === 'warn' ? 'alert-circle-outline' : tone === 'danger' ? 'warning-outline' : 'information-circle-outline');
  return (
    <View style={[styles.notice, { borderColor: `${c}44`, backgroundColor: `${c}14` }]}>
      <Ionicons name={ic} size={18} color={c} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <AppText variant="bodyStrong" color={c}>{title}</AppText> : null}
        {typeof children === 'string' ? (
          <AppText variant="caption" secondary>
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 10,
    gap: spacing.md,
  },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: 14, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: c.ink },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.md,
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  statTile: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    minWidth: 0,
  },
  statGlass: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    minWidth: 0,
  },
  statInner: { padding: spacing.md, gap: spacing.xs, flexGrow: 1 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  statValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  track: { backgroundColor: c.surfaceAlt, overflow: 'hidden', width: '100%' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  segmented: {
    flexDirection: 'row',
    backgroundColor: c.surfaceAlt,
    borderRadius: radii.pill,
    padding: 4,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radii.pill, minHeight: 48, justifyContent: 'center' },
  segmentActive: { backgroundColor: c.surface, shadowColor: c.shadow, shadowOpacity: t.dark ? 0.3 : 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segmentedGlass: {
    flexDirection: 'row',
    borderRadius: radii.pill,
    padding: 4,
    overflow: 'hidden',
  },
  segmentActiveGlass: { backgroundColor: 'rgba(255, 255, 255, 0.16)', borderRadius: radii.pill },
  kv: {
    flexDirection: 'row',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: spacing.md,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});

/** Serif section title with an optional "See all" action. */
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </AppText>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${title}: ${action}`} style={styles.sectionAction}>
          <AppText variant="bodyStrong" color={colors.primary}>
            {action}
          </AppText>
          <Ionicons name="arrow-forward" size={17} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Group label with Wren's mint accent bar, separating groups of cards. */
export function Eyebrow({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 32, marginBottom: 14 }, style]}>
      <View style={{ width: 18, height: 4, borderRadius: 2, backgroundColor: colors.teal }} />
      <AppText variant="eyebrow" secondary accessibilityRole="header">
        {children}
      </AppText>
    </View>
  );
}

/** Small capsule toggles that switch what a card shows. */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.chips} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}>
            <AppText variant="bodyStrong" color={active ? colors.onInk : colors.text} style={{ fontSize: 14 }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
