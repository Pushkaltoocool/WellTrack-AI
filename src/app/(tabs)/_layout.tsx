import { Tabs } from 'expo-router';
import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { TabBarProvider } from '@/components/ui/tabBarState';
import { useTheme } from '@/theme/ThemeProvider';
export const unstable_settings = { anchor: 'home' };
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
      {/* SDK 58 redirects hidden routes. The custom bar alone omits these destinations. */}
      <Tabs.Screen name="activity" options={{ title: 'Movement' }} />
      <Tabs.Screen name="wellness" options={{ title: 'Wellness support' }} />
    </Tabs>
  </TabBarProvider>;
}
