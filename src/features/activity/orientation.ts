/**
 * Placement check for live tracking. In UCI HAR the phone was worn sideways on the belt, so
 * for an upright person gravity lies along +X (≈ +1 g); when lying down it moves to Y/Z.
 * If live gravity points along another axis, posture classes (sit/stand/lie) are unreliable.
 */
export interface OrientationCheck {
  dominantAxis: 'x' | 'y' | 'z';
  /** True when gravity is mostly along +X, like an upright person in the training data. */
  matchesTraining: boolean;
  message: string | null;
}

export function orientationCheck(mean: { x: number; y: number; z: number }): OrientationCheck | null {
  const mag = Math.hypot(mean.x, mean.y, mean.z);
  if (!Number.isFinite(mag) || mag < 0.5) return null; // not enough data / free fall
  const ax = Math.abs(mean.x);
  const ay = Math.abs(mean.y);
  const az = Math.abs(mean.z);
  const dominantAxis = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
  if (dominantAxis === 'x' && mean.x > 0) return { dominantAxis, matchesTraining: true, message: null };
  if (dominantAxis === 'x') {
    return {
      dominantAxis,
      matchesTraining: false,
      message: 'The phone appears to be sideways but upside down compared with the training data. Rotate it 180° on your belt for more reliable results.',
    };
  }
  return {
    dominantAxis,
    matchesTraining: false,
    message:
      dominantAxis === 'y'
        ? 'Gravity is mostly along the phone’s Y axis (e.g. held upright in portrait or in a pocket). In the training data an upright person had gravity along X (phone sideways on the belt), so sitting or standing may be reported as lying down. Walking detection is less affected.'
        : 'Gravity is mostly along the phone’s Z axis (phone lying flat, screen up or down). Unless you are lying down, posture predictions will be unreliable in this position.',
  };
}
