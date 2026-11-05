import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { Owl } from './Owl';

export function EveningScene({ mood = 3 }: { mood?: number }) {
  const { colors } = useTheme();
  return <View style={styles.scene} accessible={false}>
    <LinearGradient colors={['#121828', '#222C48']} style={StyleSheet.absoluteFill} />
    <View style={styles.moon} />
    <View style={[styles.star, { left: 44, top: 34 }]} />
    <View style={[styles.star, { left: 92, top: 70, opacity: 0.5 }]} />
    <View style={[styles.star, { right: 100, top: 58, opacity: 0.45 }]} />
    <Svg width="100%" height={60} viewBox="0 0 345 60" preserveAspectRatio="none" style={styles.hill}>
      <Path d="M0 36C80 16 160 20 220 31S310 45 345 27V60H0Z" fill={colors.surface} />
    </Svg>
    <View style={styles.owl}><Owl mood={mood} size={132} /></View>
  </View>;
}
const styles = StyleSheet.create({
  scene: { height: 172, overflow: 'hidden' },
  moon: { position: 'absolute', top: 26, right: 40, width: 30, height: 30, borderRadius: 15, backgroundColor: '#F2E6D2' },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#F1EBE2', opacity: 0.6 },
  hill: { position: 'absolute', left: 0, bottom: -1 }, owl: { position: 'absolute', top: 26, alignSelf: 'center' },
});
