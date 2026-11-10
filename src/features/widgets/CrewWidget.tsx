/**
 * Home-screen widget: a companion (or the whole crew) with a line for this part of the day.
 *  - Long-press → Edit Widget picks who appears (or "Surprise me", which follows the time of day).
 *  - The shuffle button picks a new line (and, on Surprise, the next friend) without opening the app.
 *  - Tapping anywhere else opens a new journal entry that starts with the quote.
 * Runs in the widget extension's isolated runtime ('widget' directive): no hooks, no module-scope
 * values. Quote pools and image paths arrive in props (see widgetSync.ts), so the widget can
 * shuffle on its own. Widgets can't animate continuously; each timeline entry (every two hours)
 * moves the crew to a new spot and pose, and iOS animates between entries.
 */
import { Button, HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  offset,
  resizable,
  rotationEffect,
  shapes,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type CrewWidgetProps = {
  /** All lines by pool: wren, pika, char, crew, night. */
  pools: Record<string, string[]>;
  /** file:// URIs keyed `${companion}-${pose}`. */
  art: Record<string, string>;
  /** This timeline slot's choice (Surprise mode). */
  speaker: string;
  pose: string;
  pool: string;
  quoteIndex: number;
  scene: number;
  /** Times the shuffle button was pressed during this slot. */
  shuffle: number;
};

export type CrewWidgetConfig = { companion?: string };

const CrewWidget = (props: CrewWidgetProps, environment: WidgetEnvironment<CrewWidgetConfig>) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const paper = dark ? '#1B2030' : '#FFF8EE';
  const ink = dark ? '#F3EEE6' : '#1F2A44';
  const muted = dark ? '#A9B0C0' : '#7A7F8C';
  const chip = dark ? '#262C3F' : '#F1E7D8';
  const names: Record<string, string> = { wren: 'Wren', pika: 'Pika', char: 'Char', crew: 'Wren, Pika & Char' };
  const accents: Record<string, string> = dark
    ? { wren: '#6FD3BE', pika: '#E2B07A', char: '#F08B70', crew: '#6FD3BE' }
    : { wren: '#2C8F7B', pika: '#A86F32', char: '#C9523A', crew: '#2C8F7B' };

  // Who speaks: the user's pick, or the time of day (moved along by shuffles).
  const order = ['pika', 'char', 'wren', 'crew'];
  const choice = environment.configuration?.companion ?? 'auto';
  const base = order.includes(props.speaker) ? props.speaker : 'wren';
  const speaker = choice !== 'auto' && order.includes(choice) ? choice : props.shuffle > 0 ? order[(order.indexOf(base) + props.shuffle) % order.length] : base;
  const night = props.pool === 'night';
  const poolKey = night && choice === 'auto' && props.shuffle === 0 ? 'night' : speaker;
  const lines = props.pools[poolKey] ?? props.pools[speaker] ?? [];
  const quote = lines.length ? lines[(props.quoteIndex + props.shuffle) % lines.length] : 'You’re doing better than you think.';
  const pose = night ? (poolKey === 'night' ? 'sleep' : 'idle') : props.shuffle % 2 === 1 ? 'cheer' : props.pose;
  const accent = accents[speaker] ?? accents.wren;
  const by = names[speaker] ?? 'Wren';
  const url = `welltrack://entry?prompt=${encodeURIComponent(`“${quote}” — ${by}`)}`;

  const turn = (props.scene + props.shuffle) % 3;
  const trio = speaker === 'crew' ? [order[turn], order[(turn + 1) % 3], order[(turn + 2) % 3]] : [];
  const src = (id: string) => props.art[`${id}-${pose}`] ?? props.art[`${id}-idle`] ?? '';
  const tilt = turn === 0 ? -6 : turn === 1 ? 5 : 0;
  const pic = (id: string, size: number, extra: ReturnType<typeof offset>[] = []) => {
    const uri = src(id);
    return uri ? <Image uiImage={uri} modifiers={[resizable(), frame({ width: size, height: size }), ...extra]} /> : null;
  };
  const art = (big: number) =>
    speaker === 'crew' ? (
      <ZStack alignment="bottom" modifiers={[frame({ width: big * 1.35, height: big })]}>
        {pic(trio[0], big * 0.56, [offset({ x: -big * 0.42, y: 0 }), rotationEffect(-8)])}
        {pic(trio[2], big * 0.56, [offset({ x: big * 0.42, y: 0 }), rotationEffect(8)])}
        {pic(trio[1], big * 0.8, [offset({ x: 0, y: -big * 0.06 })])}
      </ZStack>
    ) : (
      pic(speaker, big, [rotationEffect(tilt), offset({ x: turn === 0 ? -4 : turn === 1 ? 4 : 0, y: 0 })])
    );
  const shuffleButton = (
    <Button target="shuffle" onPress={() => ({ ...props, shuffle: props.shuffle + 1 })} modifiers={[buttonStyle('plain')]}>
      <Image systemName="shuffle" size={14} color={accent} modifiers={[frame({ width: 32, height: 32 }), background(chip, shapes.circle())]} />
    </Button>
  );
  const quoteText = (size: number, lines: number) => (
    <Text modifiers={[font({ size, weight: 'semibold', design: 'serif' }), foregroundStyle(ink), lineLimit(lines), minimumScaleFactor(0.7)]}>{quote}</Text>
  );
  const byline = (size: number) => <Text modifiers={[font({ size, weight: 'semibold' }), foregroundStyle(accent), lineLimit(1)]}>{by}</Text>;
  const root = [containerBackground(paper, 'widget'), widgetURL(url)];

  if (environment.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={4} modifiers={root}>
        <HStack alignment="top" spacing={0}>
          {art(speaker === 'crew' ? 54 : 70)}
          <Spacer />
          {shuffleButton}
        </HStack>
        <Spacer />
        {quoteText(15, 3)}
        {byline(11)}
      </VStack>
    );
  }

  if (environment.widgetFamily === 'systemLarge') {
    return (
      <VStack alignment="leading" spacing={10} modifiers={root}>
        <HStack alignment="top" spacing={0}>
          <Spacer />
          {shuffleButton}
        </HStack>
        <HStack spacing={0}>
          <Spacer />
          {art(speaker === 'crew' ? 140 : 168)}
          <Spacer />
        </HStack>
        <Spacer />
        {quoteText(26, 4)}
        {byline(14)}
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>Tap to start a journal entry with this</Text>
      </VStack>
    );
  }

  return (
    <HStack spacing={12} modifiers={root}>
      {art(speaker === 'crew' ? 104 : 128)}
      <VStack alignment="leading" spacing={6}>
        <HStack alignment="top" spacing={6}>
          {quoteText(20, 3)}
          <Spacer />
          {shuffleButton}
        </HStack>
        {byline(13)}
        <Spacer />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>Tap to write about it</Text>
      </VStack>
    </HStack>
  );
};

export default createWidget<CrewWidgetProps, CrewWidgetConfig>('CrewWidget', CrewWidget, {
  pools: { crew: ['Whatever today is, you’re not doing it alone.'] },
  art: {},
  speaker: 'crew',
  pose: 'cheer',
  pool: 'crew',
  quoteIndex: 0,
  scene: 1,
  shuffle: 0,
});
