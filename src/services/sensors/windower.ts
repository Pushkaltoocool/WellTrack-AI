/**
 * Converts asynchronous accelerometer / gyroscope callbacks into fixed-rate 50 Hz windows
 * (128 samples, 64-sample step) matching the UCI HAR windowing.
 *
 * Each sensor stream is buffered with its own timestamps (seconds). A shared output clock
 * advances in 1/50 s steps; a grid point is emitted only once every required stream has a
 * sample at or after it, and values are linearly interpolated between the bracketing samples.
 * Gaps longer than MAX_GAP_S (sensor stall, pause, app switch) reset the buffer rather than
 * interpolating across missing data.
 */

export interface TimedSample {
  t: number; // seconds
  x: number;
  y: number;
  z: number;
}

export interface WindowerOptions {
  sampleRateHz?: number;
  windowSize?: number;
  step?: number;
  /** If false, gyroscope channels are emitted as zeros and only acceleration is required. */
  useGyro?: boolean;
  maxGapS?: number;
}

export type SixChannelWindow = Float64Array[]; // [ax, ay, az, gx, gy, gz]

const EXACT_EPS = 1e-9;

export class SensorWindower {
  readonly sampleRateHz: number;
  readonly windowSize: number;
  readonly step: number;
  readonly useGyro: boolean;
  readonly maxGapS: number;

  private acc: TimedSample[] = [];
  private gyro: TimedSample[] = [];
  private nextT: number | null = null;
  private out: number[][] = [[], [], [], [], [], []];
  private resets = 0;

  constructor(opts: WindowerOptions = {}) {
    this.sampleRateHz = opts.sampleRateHz ?? 50;
    this.windowSize = opts.windowSize ?? 128;
    this.step = opts.step ?? 64;
    this.useGyro = opts.useGyro ?? true;
    this.maxGapS = opts.maxGapS ?? 0.25;
  }

  get resetCount(): number {
    return this.resets;
  }

  /** Number of resampled samples currently buffered toward the next window. */
  get buffered(): number {
    return this.out[0].length;
  }

  /** Sensor time (s) of the next grid point; the last emitted sample sits one step before it. */
  get nextGridTime(): number | null {
    return this.nextT;
  }

  reset(): void {
    this.acc = [];
    this.gyro = [];
    this.nextT = null;
    this.out = [[], [], [], [], [], []];
  }

  pushAccelerometer(s: TimedSample): SixChannelWindow[] {
    return this.push(this.acc, s);
  }

  pushGyroscope(s: TimedSample): SixChannelWindow[] {
    if (!this.useGyro) return [];
    return this.push(this.gyro, s);
  }

  private push(buf: TimedSample[], s: TimedSample): SixChannelWindow[] {
    const last = buf[buf.length - 1];
    if (last) {
      if (s.t <= last.t) return []; // out-of-order or duplicate timestamp
      if (s.t - last.t > this.maxGapS) {
        this.resets++;
        this.reset();
      }
    }
    buf.push(s);
    return this.drain();
  }

  private drain(): SixChannelWindow[] {
    const windows: SixChannelWindow[] = [];
    const streams = this.useGyro ? [this.acc, this.gyro] : [this.acc];
    if (streams.some((b) => b.length === 0)) return windows;
    if (this.nextT === null) this.nextT = Math.max(...streams.map((b) => b[0].t));
    const dt = 1 / this.sampleRateHz;

    // Emit every grid point that all streams have already passed.
    const latestCommon = Math.min(...streams.map((b) => b[b.length - 1].t));
    let guard = 0;
    while (this.nextT <= latestCommon + EXACT_EPS && guard++ < 10_000) {
      const a = interpolate(this.acc, this.nextT);
      const g = this.useGyro ? interpolate(this.gyro, this.nextT) : { x: 0, y: 0, z: 0 };
      if (!a || !g) break;
      this.out[0].push(a.x);
      this.out[1].push(a.y);
      this.out[2].push(a.z);
      this.out[3].push(g.x);
      this.out[4].push(g.y);
      this.out[5].push(g.z);
      this.nextT += dt;
      if (this.out[0].length >= this.windowSize) {
        windows.push(this.out.map((c) => Float64Array.from(c.slice(0, this.windowSize))));
        this.out = this.out.map((c) => c.slice(this.step));
      }
    }
    // Drop raw samples no longer needed for interpolation.
    const keepFrom = this.nextT - 2 * dt;
    for (const b of streams) {
      let drop = 0;
      while (drop < b.length - 1 && b[drop + 1].t <= keepFrom) drop++;
      if (drop > 0) b.splice(0, drop);
    }
    return windows;
  }
}

function interpolate(buf: TimedSample[], t: number): { x: number; y: number; z: number } | null {
  // buffers are short (pruned each drain), linear scan is fine
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (Math.abs(b.t - t) < EXACT_EPS) return { x: b.x, y: b.y, z: b.z };
    if (b.t > t) {
      if (i === 0) return { x: b.x, y: b.y, z: b.z }; // grid starts at this stream's first sample
      const a = buf[i - 1];
      const f = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    }
  }
  const last = buf[buf.length - 1];
  return last && Math.abs(last.t - t) < EXACT_EPS ? { x: last.x, y: last.y, z: last.z } : null;
}
