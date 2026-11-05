import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';
import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ml' | 'teal' | 'light' | 'outline';
export interface ButtonProps {
  label: string; onPress: () => void; variant?: Variant; icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>;
  testID?: string; accessibilityHint?: string;
}
export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, small, style, testID, accessibilityHint }: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const foreground = variant === 'primary' ? colors.onInk : ['ml', 'teal'].includes(variant) ? colors.textOnAccent : variant === 'danger' ? colors.rose : colors.text;
  const background = { primary: colors.ink, secondary: colors.surfaceAlt, ghost: 'transparent', danger: colors.roseSoft, ml: colors.violet, teal: colors.teal, light: colors.surface, outline: 'transparent' }[variant];
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} testID={testID}
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [styles.button, { backgroundColor: background }, variant === 'outline' && styles.outline, small && styles.small, pressed && styles.pressed, (disabled || loading) && styles.disabled, style]}>
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={foreground} /> : icon ? <Ionicons name={icon} size={18} color={foreground} /> : null}
        <AppText variant="bodyStrong" color={foreground} style={styles.label}>{label}</AppText>
      </View>
    </Pressable>
  );
}
const makeStyles = (c: Palette) => StyleSheet.create({
  button: { minHeight: 54, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  outline: { borderWidth: 1.5, borderColor: c.borderStrong },
  small: { minHeight: 48, paddingHorizontal: 17, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { textAlign: 'center', flexShrink: 1 }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.45 },
});
