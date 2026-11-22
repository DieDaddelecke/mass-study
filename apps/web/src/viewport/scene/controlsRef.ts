import type { CameraControlsImpl } from '@react-three/drei';

/** Shared handle on the main camera controls (used by the nav cube overlay). */
export const controlsRef: { current: CameraControlsImpl | null } = { current: null };

/**
 * Stable layer (outside the canvas) for drei `<Html>` labels: the canvas is remounted when the
 * projection or the 3D/plan mode changes, and labels mounted in its own wrapper then fail to
 * unmount ("removeChild … not a child of this node").
 */
export const labelLayerRef: { current: HTMLDivElement | null } = { current: null };
