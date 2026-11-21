import type { CameraControlsImpl } from '@react-three/drei';

/** Shared handle on the main camera controls (used by the nav cube overlay). */
export const controlsRef: { current: CameraControlsImpl | null } = { current: null };
