import { Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { TabBarProvider } from '@/components/ui/tabBarState';
import { useTheme } from '@/theme/ThemeProvider';

export const unstable_settings = { anchor: 'home' };

/**
 * One floating, collapsing tab bar on every platform (Liquid Glass on iOS 26). The native iOS tab
 * bar was tried, but its minimise-on-scroll never triggered with our scroll views.
 */
export default function TabLayout() {
  const { colors } = useTheme();
  return <TabBarProvider>
    <Tabs backBehavior="initialRoute" tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
      <Tabs.Screen name="home" options={{ title: 'Today' }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
      <Tabs.Screen name="coach" options={{ title: 'Wren' }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
    </Tabs>
  </TabBarProvider>;
}
