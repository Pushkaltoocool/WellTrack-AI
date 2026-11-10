/**
 * Feeds the iOS home-screen widget (CrewWidget): copies the companion pictures into the app-group
 * folder the widget can read, then schedules three days of two-hourly quotes. Runs on launch and
 * when the app returns to the foreground; iOS keeps showing the timeline even if the app never
 * opens again for a while.
 */
import { Asset } from 'expo-asset';
import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { CrewWidgetProps } from './CrewWidget';
import { crewTimeline, QUOTES, type CrewSlot } from './crewQuotes';

const ART_VERSION = 'v1';
/** Bump when the timeline props change shape, so an old schedule isn't kept. */
const SCHEDULE_VERSION = 2;
const ART = {
  'wren-idle': require('../../../assets/widgets/wren-idle.png'),
  'wren-cheer': require('../../../assets/widgets/wren-cheer.png'),
  'wren-sleep': require('../../../assets/widgets/wren-sleep.png'),
  'pika-idle': require('../../../assets/widgets/pika-idle.png'),
  'pika-cheer': require('../../../assets/widgets/pika-cheer.png'),
  'pika-sleep': require('../../../assets/widgets/pika-sleep.png'),
  'char-idle': require('../../../assets/widgets/char-idle.png'),
  'char-cheer': require('../../../assets/widgets/char-cheer.png'),
  'char-sleep': require('../../../assets/widgets/char-sleep.png'),
} as const;
type ArtKey = keyof typeof ART;


type WidgetModule = { default: { updateTimeline: (entries: { date: Date; props: CrewWidgetProps }[]) => void }; };
type WidgetsLib = { widgetsDirectory: string | null };

/** Copies the PNGs once per art version; returns the folder's file:// URI, or null if unavailable. */
async function ensureArt(widgetsDirectory: string): Promise<string> {
  const dir = new Directory(widgetsDirectory, `crew-${ART_VERSION}`);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  for (const [key, mod] of Object.entries(ART)) {
    const target = new File(dir, `${key}.png`);
    if (target.exists) continue;
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    if (!asset.localUri) continue;
    await new File(asset.localUri).copy(target);
  }
  return dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`;
}

function propsFor(slot: CrewSlot, base: string): CrewWidgetProps {
  const art = Object.fromEntries((Object.keys(ART) as ArtKey[]).map((k) => [k, `${base}${k}.png`]));
  const pools = Object.fromEntries(Object.entries(QUOTES).map(([k, v]) => [k, [...v]]));
  return { pools, art, speaker: slot.speaker, pose: slot.pose, pool: slot.pool, quoteIndex: slot.quoteIndex, scene: slot.scene, shuffle: 0 };
}

let lastScheduledDay: string | null = null;

export async function refreshCrewWidget(force = false): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const today = new Date().toDateString();
  const key = `${today}#${SCHEDULE_VERSION}`;
  if (!force && lastScheduledDay === key) return;
  try {
    // Lazy: expo-widgets' native module exists only in iOS builds (not Expo Go).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require('expo-widgets') as WidgetsLib;
    if (!lib.widgetsDirectory) return;
    const base = await ensureArt(lib.widgetsDirectory);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const widget = (require('./CrewWidget') as WidgetModule).default;
    widget.updateTimeline(crewTimeline(Date.now()).map((slot) => ({ date: new Date(slot.at), props: propsFor(slot, base) })));
    lastScheduledDay = key;
  } catch (e) {
    console.warn('[crew-widget]', e);
  }
}
