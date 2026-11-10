import { Alert } from 'react-native';

import { AI_ENABLED, AI_VIA_PROXY } from '@/services/ai/llm';
import { useAccount } from '@/services/cloud/AccountProvider';
import { useData } from '@/services/database/DataProvider';

/** Journal AI consent (separate from the coach's) and the ID token the proxy needs. */
export function useJournalAi() {
  const { prefs, updatePrefs } = useData();
  const { user } = useAccount();
  const allowed = AI_ENABLED && prefs.journalAiConsentAt !== null;

  const requestConsent = () =>
    new Promise<boolean>((resolve) => {
      if (!AI_ENABLED) return resolve(false);
      if (prefs.journalAiConsentAt !== null) return resolve(true);
      Alert.alert(
        'Let Wren read your entries?',
        'To name the feelings in an entry and ask follow-up questions, the entry’s text is sent to OpenRouter and the AI model provider. Wren doesn’t store it on any server. Without this, entries are read on your phone with a simpler keyword method. You can change this any time in Settings.',
        [
          { text: 'Keep on my phone', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Allow', onPress: () => { void updatePrefs({ journalAiConsentAt: Date.now() }); resolve(true); } },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });

  const idToken = async () => (AI_VIA_PROXY && user ? user.getIdToken() : null);
  return { allowed, requestConsent, idToken };
}
