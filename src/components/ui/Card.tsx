import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useStyles, type Theme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';
export interface CardProps {
  children: ReactNode; style?: StyleProp<ViewStyle>; gradient?: readonly [string, string, ...string[]];
  onPress?: () => void; padded?: boolean; accessibilityLabel?: string; accent?: string;
}
export function Card({ children, style, onPress, padded = true, accessibilityLabel }: CardProps) {
  const styles = useStyles(makeStyles);
  const content = <View style={padded ? styles.padded : undefined}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    style={({ pressed }) => [styles.card, !padded && styles.clip, pressed && { opacity: 0.8 }, style]}>{content}</Pressable>
    : <View style={[styles.card, !padded && styles.clip, style]}>{content}</View>;
}
const makeStyles = (c: Palette, t: Theme) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: 28, ...t.shadow.card, borderWidth: t.dark ? StyleSheet.hairlineWidth : 0, borderColor: c.border }, padded: { padding: 22 }, clip: { overflow: 'hidden' },
});
