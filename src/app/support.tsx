import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconBadge, Notice, type IconName } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type Palette } from '@/theme/tokens';

const OPTIONS: { icon: IconName; color: keyof Palette; title: string; body: string }[] = [
  {
    icon: 'school-outline',
    color: 'primary',
    title: 'University wellbeing & counselling',
    body: 'Most universities offer free, confidential counselling and wellbeing services. Check your student portal or student union website for how to book.',
  },
  {
    icon: 'book-outline',
    color: 'cyan',
    title: 'Academic advisors & tutors',
    body: 'If workload is the main pressure, your advisor, module leader or study-skills centre can help with planning, extensions or support options.',
  },
  {
    icon: 'people-outline',
    color: 'amber',
    title: 'Someone you trust',
    body: 'Talking with a friend, family member or classmate about how you feel can make things more manageable.',
  },
  {
    icon: 'medkit-outline',
    color: 'teal',
    title: 'A health professional',
    body: 'A GP, doctor or licensed mental-health professional can help if stress, low mood or sleep problems persist or affect daily life.',
  },
];

export default function Support() {
  const { colors } = useTheme();
  return (
    <Screen back title="Getting support" subtitle="You don't have to manage stress alone">
      <Notice tone="danger" icon="call-outline" title="If you are in immediate danger">
        Contact your local emergency number or a crisis line in your country right away. Wren cannot monitor you or contact
        anyone on your behalf.
      </Notice>
      <Button
        label="Find a free helpline in your country"
        icon="call-outline"
        onPress={() => void Linking.openURL('https://findahelpline.com')}
        style={{ marginTop: spacing.md }}
        accessibilityHint="Opens findahelpline.com in your browser"
      />
      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        {OPTIONS.map((o) => (
          <Card key={o.title}>
            <View style={styles.row}>
              <IconBadge icon={o.icon} color={colors[o.color]} size={42} />
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="bodyStrong">{o.title}</AppText>
                <AppText variant="caption" secondary>
                  {o.body}
                </AppText>
              </View>
            </View>
          </Card>
        ))}
      </View>
      <Card style={{ marginTop: spacing.lg }}>
        <View style={styles.row}>
          <Ionicons name="leaf-outline" size={22} color={colors.teal} />
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            Quick self-care tools
          </AppText>
        </View>
        <View style={styles.tools}>
          <Button label="Breathing" icon="leaf-outline" small variant="secondary" onPress={() => router.push('/breathing')} style={{ flex: 1 }} />
          <Button label="Focus timer" icon="timer-outline" small variant="secondary" onPress={() => router.push('/focus')} style={{ flex: 1 }} />
        </View>
      </Card>
      <AppText variant="caption" muted style={{ marginTop: spacing.lg }}>
        Wren is a wellness app, not a medical device, and does not provide diagnosis or treatment.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  tools: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
