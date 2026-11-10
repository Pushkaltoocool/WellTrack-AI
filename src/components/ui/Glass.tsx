/**
 * Liquid Glass on iOS 26+, the solid Dawn/Dusk surface everywhere else (Android, web, older iOS,
 * Reduce Transparency). Use for floating chrome only — content cards stay on paper (DESIGN.md).
 */
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, View, type ColorValue, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

const GLASS_SUPPORTED = Platform.OS === 'ios' && safe(isLiquidGlassAvailable) && safe(isGlassEffectAPIAvailable);

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/** True when Liquid Glass will actually render (iOS 26+ and Reduce Transparency is off). */
export function useLiquidGlass(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (!GLASS_SUPPORTED) return;
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((v) => alive && setReduce(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return GLASS_SUPPORTED && !reduce;
}

interface GlassProps extends ViewProps {
  children?: ReactNode;
  /** Shape/layout shared by both renderings (radius, padding, size). */
  style?: StyleProp<ViewStyle>;
  /** Extra style for the non-glass fallback: background, border, shadow. */
  fallbackStyle?: StyleProp<ViewStyle>;
  tintColor?: ColorValue;
  interactive?: boolean;
  /**
   * Glass only: animates the material away instead of fading it (Apple: glass must not sit under
   * opacity < 1). Fade the children yourself; the non-glass fallback is faded by the caller.
   */
  materialHidden?: boolean;
}

export function Glass({ children, style, fallbackStyle, tintColor, interactive, materialHidden, ...rest }: GlassProps) {
  const glass = useLiquidGlass();
  // On device, only glass that animates in *after* mounting draws reliably (the collapsed tab pill
  // always did; the full bar, mounted with glass already on, never did). So every GlassView mounts
  // with no material and animates to its target on the next frame.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!glass) return <View style={[fallbackStyle, style]} {...rest}>{children}</View>;
  const target = materialHidden ? ('none' as const) : ('regular' as const);
  const effect = !ready ? ('none' as const) : { style: target, animate: true, animationDuration: 0.2 };
  return <GlassView glassEffectStyle={effect} tintColor={tintColor} isInteractive={!!interactive && ready && !materialHidden} style={style} {...rest}>
    {children}
  </GlassView>;
}

/**
 * Legacy content-surface shim (stat tiles, segmented control in misc.tsx). Content stays on Dawn
 * paper by design, so this is always the plain fallback; only floating chrome uses <Glass>.
 */
export const LIQUID_GLASS = false;
export interface GlassSurfaceProps extends ViewProps {
  tint?: ColorValue;
  interactive?: boolean;
  variant?: 'regular' | 'clear';
  fallbackStyle?: StyleProp<ViewStyle>;
}
export function GlassSurface({ tint: _tint, interactive: _interactive, variant: _variant, fallbackStyle, style, ...rest }: GlassSurfaceProps) {
  return <View style={[fallbackStyle, style]} {...rest} />;
}
