import { Canvas } from '@react-three/fiber';
import { DirectionalLight, Object3D } from 'three';
import { useProjectStore } from '../store/projectStore';
import { useAnalysis } from '../store/useAnalysis';
import { useUiStore } from '../store/uiStore';
import { UsageLegend } from './Legend';
import { NavCube } from './NavCube';
import { CameraRig, FOV, modelBox } from './scene/CameraRig';
import { SceneContent } from './scene/SceneContent';
import { ToolLayer } from './tools/ToolLayer';
import { ViewControlBar } from './ViewControlBar';
import { useViewportStore } from './viewportStore';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Project, SolidResult } from '@kubatur/core';
import type { VisualStyle } from '../store/tools';
import './viewport.css';

// z-up world (x = east, y = north)
Object3D.DEFAULT_UP.set(0, 0, 1);

const EMPTY: readonly SolidResult[] = [];

function Lights({
  project,
  solids,
  style,
  shadows,
}: {
  project: Project;
  solids: readonly SolidResult[];
  style: VisualStyle;
  shadows: boolean;
}) {
  const box = useMemo(() => modelBox(project, solids, 60), [project, solids]);
  const cx = (box.min[0] + box.max[0]) / 2 || 0;
  const cy = (box.min[1] + box.max[1]) / 2 || 0;
  const r = Math.max(60, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 2 + 20);
  const realistic = style === 'realistic';
  // three does not refresh the shadow camera's projection when its bounds change; without this the
  // default 10 m frustum stays active and almost no shadows appear.
  const sunRef = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    sunRef.current?.shadow.camera.updateProjectionMatrix();
  }, [r, shadows]);
  return (
    <>
      <hemisphereLight args={['#ffffff', '#d8d4cc', realistic ? 0.9 : 1.1]} />
      <ambientLight intensity={realistic ? 0.35 : 0.45} />
      <directionalLight
        ref={sunRef}
        position={[cx - 0.45 * r * 2, cy - 0.9 * r * 2, r * 2]}
        intensity={realistic ? 2.2 : 1.3}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.05}
        shadow-camera-left={-r * 1.4}
        shadow-camera-right={r * 1.4}
        shadow-camera-top={r * 1.4}
        shadow-camera-bottom={-r * 1.4}
        shadow-camera-near={1}
        shadow-camera-far={r * 8}
      >
        <object3D attach="target" position={[cx, cy, 0]} />
      </directionalLight>
    </>
  );
}

/** The 3D view (SPEC §10): scene, navigation, nav cube, view control bar. */
export function Viewport3D() {
  const project = useProjectStore((s) => s.project);
  const analysis = useAnalysis();
  const style = useUiStore((s) => s.visualStyle);
  const projection = useUiStore((s) => s.projection);
  const sun = useViewportStore((s) => s.sunEnabled);
  const solids = analysis?.result.solids ?? EMPTY;
  const shadows = (style === 'realistic' || style === 'shaded') && sun;
  if (!project) return null;
  const ortho = projection === 'orthographic';
  return (
    <div className="vp-root">
      <Canvas
        key={projection}
        className="vp-canvas"
        orthographic={ortho}
        shadows={shadows}
        dpr={[1, 2]}
        flat
        // preserveDrawingBuffer: the dossier captures the canvas for its cover page.
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={
          ortho
            ? { near: -5000, far: 20000, up: [0, 0, 1], position: [-100, -100, 100] }
            : { fov: FOV, near: 0.5, far: 20000, up: [0, 0, 1], position: [-100, -100, 100] }
        }
        onPointerMissed={(e) => {
          if (e.button === 0 && useUiStore.getState().tool.kind === 'select')
            useUiStore.getState().setSelection([]);
        }}
        onPointerLeave={() => useUiStore.getState().setHover(null)}
      >
        <Lights project={project} solids={solids} style={style} shadows={shadows} />
        <SceneContent project={project} solids={solids} style={style} shadows={shadows} />
        <CameraRig project={project} solids={solids} projection={projection} />
        <ToolLayer />
      </Canvas>
      <NavCube />
      <ViewControlBar />
      {style === 'consistentColors' && <UsageLegend />}
    </div>
  );
}
