import { useState } from 'react';
import { View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { todayKey } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { listRecommendations, setRecommendationStatus } from '@/services/database/repositories';
import { useTheme } from '@/theme/ThemeProvider';

/** Completion is persisted against the real suggestion, never just a local visual toggle. */
export function SuggestionCompletion({ route }: { route: '/focus' | '/breathing' }) {
  const { colors } = useTheme();
  const { db, invalidate } = useData();
  const { data } = useDbQuery((d) => listRecommendations(d, { dateKey: todayKey() }), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const rec = data?.find((r) => r.status !== 'dismissed' && r.actions.some((a) => a.route === route));
  if (!rec) return null;
  return <View style={{ gap: 6 }}>
    <Button label={rec.status === 'completed' ? 'Marked as done' : 'Mark today’s suggestion as done'} variant="ghost" icon="checkmark" loading={busy} disabled={rec.status === 'completed'} onPress={async () => {
      setBusy(true); setError(false);
      try { await setRecommendationStatus(db, rec.id, 'completed'); invalidate(); }
      catch { setError(true); } finally { setBusy(false); }
    }} />
    {error ? <AppText variant="caption" color={colors.rose}>Could not save completion. Please try again.</AppText> : null}
  </View>;
}
