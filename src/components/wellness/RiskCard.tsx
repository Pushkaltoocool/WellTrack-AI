import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/theme/ThemeProvider';
import type { RiskLevel } from '@/types/domain';

export function RiskCard({ risk, when, onPress }: { risk: RiskLevel; when?: string; onPress?: () => void }) {
  const { colors, riskColors } = useTheme();
  return <Card onPress={onPress} accessibilityLabel={`Experimental stress risk: ${risk}. Open explanation.`}>
    <View style={{ gap: 12 }}>
      <View style={styles.row}><AppText variant="caption" secondary>Stress risk</AppText>{when ? <AppText variant="caption" muted style={{ flexShrink: 1, textAlign: 'right' }}>{when}</AppText> : null}</View>
      <AppText variant="title">{risk}</AppText>
      <View style={[styles.row, { gap: 6 }]}>
        {(['Low', 'Moderate', 'High'] as const).map((level) => <View key={level} style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: risk === level ? riskColors[level] : colors.surfacePressed }} />
          <AppText variant="caption" color={risk === level ? colors.text : colors.textMuted}>{level}</AppText>
        </View>)}
      </View>
      <AppText variant="caption" secondary>An experimental estimate from your check-in, not a diagnosis.</AppText>
    </View>
  </Card>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 } });
