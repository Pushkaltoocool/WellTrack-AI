import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';
import { AppText } from './AppText';
import { useCollapseOnScroll } from './tabBarState';
export function ScreenBackground() { const { colors } = useTheme(); return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />; }
export interface ScreenProps {
  children: ReactNode; title?: string; subtitle?: string; back?: boolean; right?: ReactNode; scroll?: boolean;
  onRefresh?: () => void; refreshing?: boolean; bottomInset?: number; footer?: ReactNode;
}
export function Screen({ children, title, subtitle, back, right, scroll = true, onRefresh, refreshing = false, bottomInset = 0, footer }: ScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const onScroll = useCollapseOnScroll(usePathname().split('/')[1]);
  const header = title || back ? <View style={styles.header}>
    {back ? <View style={styles.topRow}><Pressable accessibilityRole="button" accessibilityLabel="Go back"
      onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} style={styles.back}>
      <Ionicons name="close" size={21} color={colors.text} />
    </Pressable>{right}</View> : null}
    {title ? <AppText variant={back ? 'title' : 'display'} accessibilityRole="header">{title}</AppText> : null}
    {subtitle ? <AppText secondary>{subtitle}</AppText> : null}
    {!back ? right : null}
  </View> : null;
  const padding = { paddingTop: insets.top + 20, paddingBottom: footer ? 24 : insets.bottom + 112 + bottomInset, paddingHorizontal: 24 };
  return <View style={styles.root}>
    {scroll ? <ScrollView contentContainerStyle={[styles.content, padding]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      onScroll={onScroll} scrollEventThrottle={32}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
      {header}{children}
    </ScrollView> : <View style={[styles.content, padding, { flex: 1, paddingBottom: 24 }]}>{header}{children}</View>}
    {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}><View style={styles.footerContent}>{footer}</View></View> : null}
  </View>;
}
const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg }, content: { flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: 8, marginBottom: 24 }, topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  back: { width: 48, height: 48, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: 12, paddingHorizontal: 24, backgroundColor: c.bg }, footerContent: { width: '100%', maxWidth: 592, alignSelf: 'center' },
});
