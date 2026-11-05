/** Compatibility surface for the shared primitives. Evening uses opaque dusk surfaces. */
import { View, type ColorValue, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
export const LIQUID_GLASS = false;
export interface GlassSurfaceProps extends ViewProps {
  /** Glass tint (iOS) — semi-transparent colours keep the refraction visible. */
  tint?: ColorValue;
  /** Native press response (scale and shimmer) for tappable glass. */
  interactive?: boolean;
  variant?: 'regular' | 'clear';
  /** Background and border used when Liquid Glass is unavailable. */
  fallbackStyle?: StyleProp<ViewStyle>;
}

export function GlassSurface({ tint: _tint, interactive: _interactive, variant: _variant, fallbackStyle, style, ...rest }: GlassSurfaceProps) {
  return <View style={[fallbackStyle, style]} {...rest} />;
}
