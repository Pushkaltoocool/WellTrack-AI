import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider, router, usePathname } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TrackerProvider } from '@/features/activity/TrackerProvider';
import { useAllDaySync } from '@/features/motion/useAllDaySync';
import { useReminderSync } from '@/features/reminders/useReminderSync';
import { AppLock } from '@/features/security/AppLock';
import { AccountProvider, useAccount } from '@/services/cloud/AccountProvider';
import { DataProvider } from '@/services/database/DataProvider';
import { AppThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Deep links (widget → new journal entry) open on top of the tabs, so closing returns to Today. */
export const unstable_settings = { anchor: '(tabs)' };

/** iOS: native page sheet (Liquid Glass on iOS 26). Android: slide up as before. */
const SHEET = Platform.OS === 'ios' ? ({ presentation: 'modal' } as const) : ({ animation: 'slide_from_bottom' } as const);
/**
 * The journal editor is full-screen: inside an iOS page sheet React Native measures views relative to
 * the sheet, so keyboard avoidance came up short by the sheet's top offset and hid the toolbar.
 */
const WRITING = Platform.OS === 'ios' ? ({ presentation: 'fullScreenModal', animation: 'slide_from_bottom' } as const) : ({ animation: 'slide_from_bottom' } as const);

/** App-wide side effects that need the data layer (reminder scheduling, notification taps). */
function AppServices() {
  useReminderSync();
  useAllDaySync();
  return null;
}

/** Accounts are required: losing the session (sign-out, account deletion) returns to the sign-in gate. */
function AuthGuard() {
  const { enabled, initializing, user } = useAccount();
  const pathname = usePathname();
  const signedOut = enabled && !initializing && !user;
  useEffect(() => {
    if (signedOut && pathname !== '/' && pathname !== '/account') router.replace('/account?from=gate');
  }, [signedOut, pathname]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Figtree: require('../../assets/fonts/Figtree-Regular.ttf'),
    FigtreeMedium: require('../../assets/fonts/Figtree-Medium.ttf'),
    FigtreeSemiBold: require('../../assets/fonts/Figtree-SemiBold.ttf'),
    FigtreeBold: require('../../assets/fonts/Figtree-Bold.ttf'),
    Fraunces: require('../../assets/fonts/Fraunces-Regular.ttf'),
    FrauncesItalic: require('../../assets/fonts/FrauncesItalic-Regular.ttf'),
  });
  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <Themed />
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

function Themed() {
  const { colors, dark } = useTheme();
  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: { ...(dark ? DarkTheme : DefaultTheme).colors, background: colors.bg, card: colors.bgElevated, primary: colors.primary, text: colors.text, border: colors.border },
  };
  return (
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <DataProvider>
          <AccountProvider>
            <TrackerProvider>
              <AppServices />
              <AuthGuard />
              <AppLock>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.bg },
                    animation: 'slide_from_right',
                  }}>
                  <Stack.Screen name="index" options={{ animation: 'none' }} />
                  <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
                  <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                  <Stack.Screen name="checkin" options={SHEET} />
                  <Stack.Screen name="breathing" />
                  <Stack.Screen name="focus" />
                  <Stack.Screen name="stress" />
                  <Stack.Screen name="support" />
                  <Stack.Screen name="account" />
                  <Stack.Screen name="settings" />
                  <Stack.Screen name="entry" options={WRITING} />
                  <Stack.Screen name="insights" />
                  <Stack.Screen name="exams" />
                  <Stack.Screen name="letter" />
                  <Stack.Screen name="collect" />
                  <Stack.Screen name="activity" />
                  <Stack.Screen name="wellness" />
                  <Stack.Screen name="research" options={SHEET} />
                </Stack>
              </AppLock>
            </TrackerProvider>
          </AccountProvider>
        </DataProvider>
      </ThemeProvider>
  );
}
