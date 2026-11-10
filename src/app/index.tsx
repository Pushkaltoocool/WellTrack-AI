import { Redirect } from 'expo-router';

import { useAccount } from '@/services/cloud/AccountProvider';
import { useData } from '@/services/database/DataProvider';

/** Entry gate: an account is required first, then onboarding on first launch, then the dashboard. */
export default function Index() {
  const { prefs } = useData();
  const account = useAccount();
  if (account.enabled && account.initializing) return null; // splash stays up via the root layout
  if (account.enabled && !account.user) return <Redirect href="/account?from=gate" />;
  return <Redirect href={prefs.onboardingComplete ? '/home' : '/onboarding'} />;
}
