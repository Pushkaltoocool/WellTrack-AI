import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';

import { AppText } from './AppText';

/**
 * Data-provenance label. Every number shown to the user is tagged with where it came from,
 * so measured data, ML output, self-reports, rules and recorded demo data are never confused.
 */
export type DataSource = 'measured' | 'ml' | 'ai' | 'personal' | 'self-reported' | 'rule' | 'recorded' | 'experimental' | 'unavailable';

const metaFor = (colors: Palette): Record<DataSource, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> => ({
  measured: { label: 'Sensor-measured', color: colors.cyan, bg: colors.cyanSoft, icon: 'pulse' },
  ml: { label: 'ML prediction', color: colors.violet, bg: colors.violetSoft, icon: 'sparkles' },
  ai: { label: 'AI-generated', color: colors.violet, bg: colors.violetSoft, icon: 'chatbubble-ellipses-outline' },
  personal: { label: 'Your personal model', color: colors.teal, bg: colors.tealSoft, icon: 'person-circle-outline' },
  'self-reported': { label: 'Self-reported', color: colors.teal, bg: colors.tealSoft, icon: 'create-outline' },
  rule: { label: 'Rule-based', color: colors.primary, bg: colors.primarySoft, icon: 'git-branch-outline' },
  recorded: { label: 'Recorded demo data', color: colors.amber, bg: colors.amberSoft, icon: 'play-circle-outline' },
  experimental: { label: 'Experimental', color: colors.amber, bg: colors.amberSoft, icon: 'flask-outline' },
  unavailable: { label: 'Unavailable', color: colors.textMuted, bg: 'rgba(116,130,174,0.14)', icon: 'remove-circle-outline' },
});

export function SourceTag({ source, label }: { source: DataSource; label?: string }) {
  const { colors } = useTheme();
  const m = metaFor(colors)[source];
  return (
    <View style={[styles.tag, { backgroundColor: m.bg }]} accessibilityLabel={`Data source: ${label ?? m.label}`}>
      <Ionicons name={m.icon} size={11} color={m.color} />
      <AppText variant="micro" color={m.color}>
        {(label ?? m.label).toUpperCase()}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
});
