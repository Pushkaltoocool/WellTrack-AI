import { Redirect } from 'expo-router';

import { useData } from '@/services/database/DataProvider';

/** Entry gate: first launch goes to onboarding, otherwise straight to the dashboard. */
export default function Index() {
  const { prefs } = useData();
  return <Redirect href={prefs.onboardingComplete ? '/home' : '/onboarding'} />;
}
