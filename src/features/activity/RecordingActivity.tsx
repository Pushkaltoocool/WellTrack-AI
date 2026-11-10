/**
 * Live Activity shown while a labelled recording runs: Lock Screen banner + Dynamic Island.
 * This component runs in the widget extension's isolated runtime ('widget' directive): no hooks,
 * no imports used inside, nothing from module scope — everything comes in through props.
 * The timer is SwiftUI's own date-style text, so it keeps ticking even between app updates.
 */
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type RecordingActivityProps = {
  /** "Walking", "Sleeping / lying down"… */
  label: string;
  /** "Trouser pocket"… */
  placement: string;
  /** SF Symbol for the activity. */
  symbol: string;
  startedAtMs: number;
  /** Set when the recording is finished, to freeze the final state. */
  endedAtMs?: number | null;
};

const RecordingActivity = (props: RecordingActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const mint = environment.isLuminanceReduced ? '#FFFFFF' : '#6FD3BE';
  const start = new Date(props.startedAtMs);
  const done = !!props.endedAtMs;
  const elapsed = done ? Math.max(0, Math.round(((props.endedAtMs ?? 0) - props.startedAtMs) / 1000)) : 0;
  const finalClock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const clock = (size: number) =>
    done ? (
      <Text modifiers={[font({ size, weight: 'semibold' }), monospacedDigit()]}>{finalClock}</Text>
    ) : (
      <Text date={start} dateStyle="timer" modifiers={[font({ size, weight: 'semibold' }), monospacedDigit(), foregroundStyle(mint)]} />
    );

  return {
    banner: (
      <HStack spacing={14} modifiers={[padding({ all: 16 })]}>
        <Image systemName={props.symbol as never} color={mint} size={26} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle('#9AA3B5')]}>{done ? 'Recording saved' : 'Recording for Wren'}</Text>
          <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{props.label}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle('#9AA3B5')]}>{props.placement}</Text>
        </VStack>
        <Spacer />
        {clock(30)}
      </HStack>
    ),
    compactLeading: <Image systemName={props.symbol as never} color={mint} />,
    compactTrailing: (
      <VStack modifiers={[frame({ width: 46 })]}>{clock(14)}</VStack>
    ),
    minimal: <Image systemName={props.symbol as never} color={mint} />,
    expandedLeading: (
      <VStack alignment="leading" modifiers={[padding({ leading: 6, top: 6 })]}>
        <Image systemName={props.symbol as never} color={mint} size={22} />
      </VStack>
    ),
    expandedCenter: (
      <VStack spacing={1}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.label}</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle('#9AA3B5')]}>{props.placement}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" modifiers={[padding({ trailing: 6, top: 6 })]}>{clock(18)}</VStack>
    ),
    expandedBottom: (
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#9AA3B5'), padding({ top: 4 })]}>
        {done ? 'Saved. Open Wren to see it.' : 'Keep doing just this. Hold Stop in Wren when you’re done.'}
      </Text>
    ),
  };
};

export default createLiveActivity('RecordingActivity', RecordingActivity);
