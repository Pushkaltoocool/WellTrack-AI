import { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

export const MOOD_NAMES = ['Rough', 'Low', 'Okay', 'Good', 'Great'];
export const MOOD_COLORS = ['#6B7590', '#7F9BE0', '#A9C1E8', '#6FD3BE', '#EDBB8A'];
const PALETTES = [
  ['#6B7590', '#555E77', '#C9CFDD'], ['#7F9BE0', '#6680C4', '#DDE6FF'],
  ['#A9C1E8', '#8CA6D2', '#F0F5FF'], ['#6FD3BE', '#52B6A1', '#DDF7F0'],
  ['#EDBB8A', '#D69F6B', '#FFF1E2'],
];

/** Original vector character from the supplied design, adapted to react-native-svg. */
export const Owl = memo(function Owl({ mood = 4, pose = 'idle', size = 132 }: {
  mood?: number; pose?: 'idle' | 'walk' | 'sleep' | 'calm'; size?: number;
}) {
  const m = Math.min(5, Math.max(1, Math.round(mood) || 3));
  const [body, wing, belly] = PALETTES[m - 1];
  const closed = pose === 'sleep' || pose === 'calm';
  const happy = !closed && m === 5;
  const walking = pose === 'walk';
  const beak = m === 5 ? '#D9672F' : '#F28C4B';
  return <Svg width={size} height={size} viewBox="0 0 120 120" accessible={false}>
    {walking ? <Path d="M6 58h9M3 68h12M6 78h9" fill="none" stroke="#8A8D93" strokeWidth={3} strokeLinecap="round" opacity={0.5} /> : null}
    {pose === 'sleep' ? <Path d="M98 26h8l-8 8h8M108 10h6l-6 6h6" fill="none" stroke="#8A8D93" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} /> : null}
    <G rotation={walking ? -6 : 0} origin="60,64">
      <Path d="M33 30 28 10 46 24ZM87 30 92 10 74 24Z" fill={body} stroke={body} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M60 16C35 16 21 37 21 64c0 29 17 45 39 45s39-16 39-45C99 37 85 16 60 16z" fill={body} />
      <Ellipse cx={60} cy={80} rx={25} ry={25} fill={belly} />
      <Path d="M49 78q5.5 5 11 0q5.5 5 11 0M53 91q3.5 4 7 0q3.5 4 7 0" fill="none" stroke={wing} strokeWidth={2} strokeLinecap="round" opacity={0.55} />
      <Path d="M23 62c-7 11-5 26 6 32 4-11 4-23-6-32z" fill={wing} rotation={walking ? 18 : 0} origin="23,62" />
      <Path d="M97 62c7 11 5 26-6 32-4-11-4-23 6-32z" fill={wing} rotation={walking ? -10 : 0} origin="97,62" />
      {!closed && !happy ? <G>
        <Circle cx={44} cy={50} r={14} fill="#FFFDF8" stroke={wing} strokeWidth={1.5} />
        <Circle cx={76} cy={50} r={14} fill="#FFFDF8" stroke={wing} strokeWidth={1.5} />
        <Circle cx={45} cy={m === 1 ? 55 : 52} r={6.5} fill="#1A2033" />
        <Circle cx={75} cy={m === 1 ? 55 : 52} r={6.5} fill="#1A2033" />
        <Circle cx={47.5} cy={m === 1 ? 52 : 49} r={2.2} fill="#FFFFFF" />
        <Circle cx={77.5} cy={m === 1 ? 52 : 49} r={2.2} fill="#FFFFFF" />
      </G> : null}
      {!closed && !happy && m <= 2 ? <Path d={m === 1 ? 'M30 34H60V44L30 52ZM60 34H90V52L60 44Z' : 'M30 34H90V44H30Z'} fill={body} /> : null}
      {closed || happy ? <Path d={closed ? 'M33 49q11 9 22 0M65 49q11 9 22 0' : 'M33 52q11-13 22 0M65 52q11-13 22 0'} fill="none" stroke="#1A2033" strokeWidth={3.5} strokeLinecap="round" /> : null}
      {m >= 4 || pose === 'calm' ? <G opacity={0.6}><Ellipse cx={30} cy={64} rx={6} ry={3.5} fill="#F2918F" /><Ellipse cx={90} cy={64} rx={6} ry={3.5} fill="#F2918F" /></G> : null}
      <Path d="M55 60h10l-5 8z" fill={beak} stroke={beak} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M50 108v3M54 108v3M66 108v3M70 108v3" stroke={beak} strokeWidth={3} strokeLinecap="round" />
    </G>
  </Svg>;
});
