import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { type as typeScale } from '@/theme/tokens';

export type TextVariant = keyof typeof typeScale;

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  muted?: boolean;
  secondary?: boolean;
}

export function AppText({ variant = 'body', color, align, muted, secondary, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const c = color ?? (muted ? colors.textMuted : secondary ? colors.textSecondary : colors.text);
  return <Text {...rest} style={[typeScale[variant], { color: c, textAlign: align }, style]} />;
}
