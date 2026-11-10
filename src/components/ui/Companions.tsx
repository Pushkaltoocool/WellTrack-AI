/**
 * Wren's crew. Original characters drawn in Wren's flat style (120×120 art boards):
 *   Wren — the owl: calm, reflective; journal, check-ins, wind-down.
 *   Pika — a pika: quick and cheerful; movement, recording activities.
 *   Char — a small ember dragon: fiery but kind; study, exams, focus.
 */
import { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { Owl } from './Owl';

export type CompanionId = 'wren' | 'pika' | 'char';
export type CompanionPose = 'idle' | 'cheer' | 'sleep';

export const PikaArt = memo(function PikaArt({ size = 120, pose = 'idle' }: { size?: number; pose?: CompanionPose }) {
  const B = '#D79E62', S = '#B9803F', BELLY = '#FFF0DA', EAR = '#F3B9A2', INK = '#2A2118';
  const closed = pose === 'sleep';
  const zoom = pose === 'cheer';
  return <Svg width={size} height={size} viewBox="0 0 120 120" accessible={false}>
    {zoom ? <Path d="M4 64h14M2 76h16M6 88h12" stroke="#C9B9A6" strokeWidth={3.5} strokeLinecap="round" /> : null}
    <G rotation={zoom ? -5 : 0} origin="60,70">
      <Circle cx={32} cy={36} r={14} fill={S} /><Circle cx={88} cy={36} r={14} fill={S} />
      <Circle cx={33} cy={37} r={7.5} fill={EAR} /><Circle cx={87} cy={37} r={7.5} fill={EAR} />
      <Path d="M60 26C33 26 18 46 18 70c0 25 18 38 42 38s42-13 42-38C102 46 87 26 60 26z" fill={B} />
      <Ellipse cx={60} cy={84} rx={25} ry={21} fill={BELLY} />
      {closed
        ? <Path d="M40 60q6 5 12 0M68 60q6 5 12 0" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />
        : <G>
          <Circle cx={46} cy={59} r={6.8} fill={INK} /><Circle cx={74} cy={59} r={6.8} fill={INK} />
          <Circle cx={48.6} cy={56.4} r={2.4} fill="#FFFFFF" /><Circle cx={76.6} cy={56.4} r={2.4} fill="#FFFFFF" />
        </G>}
      <Ellipse cx={34} cy={72} rx={6} ry={3.6} fill="#F49A8E" opacity={0.7} /><Ellipse cx={86} cy={72} rx={6} ry={3.6} fill="#F49A8E" opacity={0.7} />
      <Path d="M56.5 67.5h7l-3.5 4z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M54 75q3 3 6 0q3 3 6 0" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <Path d="M40 70l-14-3M40 74l-13 2M80 70l14-3M80 74l13 2" stroke={S} strokeWidth={1.6} strokeLinecap="round" opacity={0.8} />
      <Ellipse cx={43} cy={93} rx={6} ry={4.5} fill={S} /><Ellipse cx={77} cy={93} rx={6} ry={4.5} fill={S} />
      <Ellipse cx={46} cy={107} rx={8} ry={4} fill={S} /><Ellipse cx={74} cy={107} rx={8} ry={4} fill={S} />
    </G>
  </Svg>;
});

export const CharArt = memo(function CharArt({ size = 120, pose = 'idle' }: { size?: number; pose?: CompanionPose }) {
  const B = '#E2674A', S = '#B94A33', BELLY = '#FFD7A3', HORN = '#FFE9C7', INK = '#2A1A16';
  const closed = pose === 'sleep';
  const hype = pose === 'cheer';
  return <Svg width={size} height={size} viewBox="0 0 120 120" accessible={false}>
    <Path d="M86 98c14 2 22-6 22-16-6 4-12 4-16 2" fill="none" stroke={B} strokeWidth={8} strokeLinecap="round" />
    <Path d="M106 80l6-8-1 11z" fill={S} />
    <Path d="M34 72C22 64 12 52 10 42c8 4 12 4 16 2-2 6 2 10 6 12-2 6 0 10 4 14z" fill={S} />
    <Path d="M86 72c12-8 22-20 24-30-8 4-12 4-16 2 2 6-2 10-6 12 2 6 0 10-4 14z" fill={S} />
    <Path d="M44 30l-6-14 13 9zM76 30l6-14-13 9z" fill={HORN} stroke={HORN} strokeWidth={3} strokeLinejoin="round" />
    <Ellipse cx={60} cy={86} rx={31} ry={25} fill={B} />
    <Circle cx={60} cy={54} r={30} fill={B} />
    <Ellipse cx={60} cy={89} rx={18} ry={17} fill={BELLY} />
    <Path d="M48 84q12 5 24 0M50 94q10 4 20 0" fill="none" stroke="#F1B678" strokeWidth={2} strokeLinecap="round" />
    {closed
      ? <Path d="M41 52q7 6 14 0M65 52q7 6 14 0" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />
      : <G>
        <Circle cx={48} cy={51} r={9} fill="#FFFDF8" /><Circle cx={72} cy={51} r={9} fill="#FFFDF8" />
        <Circle cx={49.5} cy={52.5} r={5.2} fill={INK} /><Circle cx={70.5} cy={52.5} r={5.2} fill={INK} />
        <Circle cx={51.3} cy={50.6} r={1.8} fill="#FFFFFF" /><Circle cx={72.3} cy={50.6} r={1.8} fill="#FFFFFF" />
        {hype ? <Path d="M39 39l14 5M81 39l-14 5" stroke={S} strokeWidth={3.4} strokeLinecap="round" /> : null}
      </G>}
    <Ellipse cx={60} cy={66} rx={11} ry={6.5} fill="#EE8A6C" />
    <Circle cx={56.5} cy={65} r={1.5} fill={S} /><Circle cx={63.5} cy={65} r={1.5} fill={S} />
    <Path d="M53 72q7 5 14 0" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
    <Ellipse cx={35} cy={62} rx={5.5} ry={3.3} fill="#F7A49A" opacity={0.65} /><Ellipse cx={85} cy={62} rx={5.5} ry={3.3} fill="#F7A49A" opacity={0.65} />
    {hype ? <G><Circle cx={56} cy={22} r={4} fill="#D9D2CB" /><Circle cx={64} cy={16} r={5.5} fill="#E6E0DA" /><Circle cx={74} cy={12} r={4} fill="#EFEAE5" /></G> : null}
    <Ellipse cx={46} cy={109} rx={9} ry={4.5} fill={S} /><Ellipse cx={74} cy={109} rx={9} ry={4.5} fill={S} />
  </Svg>;
});

export function Companion({ id, size = 120, pose = 'idle' }: { id: CompanionId; size?: number; pose?: CompanionPose }) {
  if (id === 'pika') return <PikaArt size={size} pose={pose} />;
  if (id === 'char') return <CharArt size={size} pose={pose} />;
  return <Owl size={size} mood={pose === 'cheer' ? 5 : 4} pose={pose === 'sleep' ? 'sleep' : 'idle'} />;
}

export interface CompanionMeta {
  id: CompanionId;
  name: string;
  /** What they look after, in a few words. */
  role: string;
  /** Their colour, for small accents next to them. */
  color: string;
}

export const COMPANIONS: Record<CompanionId, CompanionMeta> = {
  wren: { id: 'wren', name: 'Wren', role: 'Notices how you feel', color: '#2C8F7B' },
  pika: { id: 'pika', name: 'Pika', role: 'Gets you moving', color: '#B9803F' },
  char: { id: 'char', name: 'Char', role: 'Fires up study days', color: '#C9523A' },
};

/** Things each of them says. Short, in their own voice; never medical, never guilt. */
export const LINES: Record<CompanionId, readonly string[]> = {
  wren: [
    'How did today actually feel? A few lines is plenty.',
    'Slow evening? Good. Let’s write one thing down before bed.',
    'You don’t have to fix the day. Just notice it.',
  ],
  pika: [
    'Ten minutes outside. I’ll race you to the corner.',
    'Stairs count. Every single one.',
    'You’ve been still a while. Stretch with me?',
  ],
  char: [
    'One focus block. We torch the hardest bit first.',
    'Exam coming? Then today’s the day we warm up.',
    'Breaks are fuel, not failure. Back in five.',
  ],
};

/** A stable pick for the day, so the line doesn't change every render. */
export function lineOfTheDay(id: CompanionId, dayKey: string): string {
  const lines = LINES[id];
  let h = 0;
  for (const ch of dayKey + id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}
