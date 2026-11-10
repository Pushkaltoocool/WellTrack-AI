/**
 * Shared state for the floating tab bar: it collapses to a single "current tab" button while the
 * user scrolls down and expands again on scroll up or tap. Screens outside the tab navigator get
 * the no-op default, so `Screen` can call these hooks unconditionally.
 */
import type { Ionicons } from '@expo/vector-icons';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { AI_ENABLED } from '@/services/ai/llm';

type IconName = keyof typeof Ionicons.glyphMap;
export interface TabDestination { name: string; label: string; icon: IconName; activeIcon: IconName; }
export const TAB_DESTINATIONS: TabDestination[] = [
  { name: 'home', label: 'Today', icon: 'home-outline', activeIcon: 'home' },
  { name: 'journal', label: 'Journal', icon: 'book-outline', activeIcon: 'book' },
  ...(AI_ENABLED ? [{ name: 'coach', label: 'Wren', icon: 'chatbubble-ellipses-outline', activeIcon: 'chatbubble-ellipses' } as const] : []),
  { name: 'trends', label: 'Trends', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'explore', label: 'Explore', icon: 'compass-outline', activeIcon: 'compass' },
];

interface TabBarState {
  /** Name of the tab route whose scroll collapsed the bar (null = expanded). */
  collapsedRoute: string | null;
  setCollapsedRoute: (route: string | null) => void;
  inTabs: boolean;
}

const TabBarContext = createContext<TabBarState>({ collapsedRoute: null, setCollapsedRoute: () => undefined, inTabs: false });

export function TabBarProvider({ children }: { children: ReactNode }) {
  const [collapsedRoute, setCollapsedRoute] = useState<string | null>(null);
  const value = useMemo(() => ({ collapsedRoute, setCollapsedRoute, inTabs: true }), [collapsedRoute]);
  return <TabBarContext.Provider value={value}>{children}</TabBarContext.Provider>;
}

export function useTabBar() {
  return useContext(TabBarContext);
}

/** True when the bar is collapsed on the given route. */
export function useTabBarCollapsed(route: string): boolean {
  return useContext(TabBarContext).collapsedRoute === route;
}

/** Scroll distance (px) in one direction before the bar changes state. */
const THRESHOLD = 8;

/**
 * onScroll handler for a tab screen's scroll view. Collapses after scrolling down past the top,
 * expands when scrolling back up or reaching the top. State only changes on direction changes.
 */
export function useCollapseOnScroll(route: string | undefined) {
  const { setCollapsedRoute, collapsedRoute, inTabs } = useContext(TabBarContext);
  const last = useRef(0);
  if (!inTabs || !route) return undefined;
  return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const y = contentOffset.y;
    const dy = y - last.current;
    const atBottom = y + layoutMeasurement.height >= contentSize.height - 4;
    if (Math.abs(dy) < THRESHOLD && y > 24) return;
    last.current = y;
    if (y <= 24 || (dy < 0 && !atBottom)) {
      if (collapsedRoute !== null) setCollapsedRoute(null);
    } else if (dy > 0 && y > 60 && collapsedRoute !== route) {
      setCollapsedRoute(route);
    }
  };
}

/** Whether the software keyboard is showing (the tab bar hides so input bars can sit on the keyboard). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** Vertical space reserved for the expanded bar (height + gap), excluding the safe-area inset. */
export const TAB_BAR_HEIGHT = 68;
export const TAB_BAR_COLLAPSED = 60;
export function tabBarBottom(insetBottom: number) {
  return Math.max(insetBottom, 14);
}

/** Distance from the screen bottom to just above the tab bar, for floating controls on tab screens. */
export function aboveTabBar(insetBottom: number): number {
  return tabBarBottom(insetBottom) + TAB_BAR_HEIGHT;
}
