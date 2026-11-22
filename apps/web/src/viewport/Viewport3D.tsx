import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight, Object3D } from 'three';
import { EffectComposer, N8AO } from '@react-three/postprocessing';
import { useProjectStore } from '../store/projectStore';
import { useAnalysis } from '../store/useAnalysis';
import { useUiStore } from '../store/uiStore';
import { GranulometryLegend, UsageLegend } from './Legend';
import { NavCube } from './NavCube';
import { CameraRig, FOV, modelBox } from './scene/CameraRig';
import { labelLayerRef } from './scene/controlsRef';
import { SceneContent } from './scene/SceneContent';
import { ToolLayer } from './tools/ToolLayer';
import { ViewControlBar } from './ViewControlBar';
import { useViewportStore } from './viewportStore';
import { useLook } from './scene/useLook';
import { LIT_STYLES, type LookSpec } from './scene/looks';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { massLayouts, storeyLabel, type Project, type SolidResult } from '@kubatur/core';
import { CutSlider } from './CutSlider';
import { PlanOverlay } from './PlanOverlay';
import { cutLevels } from './scene/storeyCut';
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
  look,
}: {
  project: Project;
  solids: readonly SolidResult[];
  style: VisualStyle;
  shadows: boolean;
  look: LookSpec;
}) {
  const box = useMemo(() => modelBox(project, solids, 60), [project, solids]);
  const cx = (box.min[0] + box.max[0]) / 2 || 0;
  const cy = (box.min[1] + box.max[1]) / 2 || 0;
  const r = Math.max(60, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 2 + 20);
  const realistic = style === 'realistic';
  const [dx, dy, dz] = look.sun.dir;
  const dl = Math.hypot(dx, dy, dz) || 1;
  const d = (2 * r * Math.SQRT2) / dl;
  // three does not refresh the shadow camera's projection when its bounds change; without this the
  // default 10 m frustum stays active and almost no shadows appear.
  const sunRef = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    sunRef.current?.shadow.camera.updateProjectionMatrix();
  }, [r, shadows, look]);
  return (
    <>
      <hemisphereLight
        args={[look.hemi.sky, look.hemi.ground, look.hemi.intensity * (realistic ? 0.85 : 1)]}
      />
      <ambientLight intensity={look.ambient * (realistic ? 0.8 : 1)} />
      <directionalLight
        ref={sunRef}
        position={[cx + dx * d, cy + dy * d, dz * d]}
        color={look.sun.color}
        intensity={look.sun.intensity * (realistic ? 1.25 : 1)}
        castShadow={shadows}
        shadow-mapSize={[4096, 4096]}
        shadow-radius={look.sun.softness}
        shadow-intensity={look.sun.shadowIntensity}
        shadow-bias={-0.0005}
        shadow-normalBias={0.05}
        shadow-camera-left={-r * 1.4}
        shadow-camera-right={r * 1.4}
        shadow-camera-top={r * 1.4}
        shadow-camera-bottom={-r * 1.4}
        shadow-camera-near={1}
        shadow-camera-far={d * 2 + r * 4}
      >
        <object3D attach="target" position={[cx, cy, 0]} />
      </directionalLight>
    </>
  );
}

/** Post-processing: screen-space ambient occlusion (soft contact shadows in corners). */
function Effects({ look, style }: { look: LookSpec; style: VisualStyle }) {
  if (!look.ao || !LIT_STYLES.has(style)) return null;
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO
        aoRadius={look.ao.radius}
        intensity={look.ao.intensity}
        distanceFalloff={1}
        color={look.ao.color}
        quality="medium"
        halfRes
      />
    </EffectComposer>
  );
}

/** Reports the plan zoom (pixels per metre) for the scale bar. */
function PlanScaleProbe() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const z = camera.zoom;
    const cur = useViewportStore.getState().pxPerMetre;
    if (Math.abs(z - cur) > cur * 0.005) useViewportStore.getState().setPxPerMetre(z);
  });
  return null;
}

/**
 * The 3D view (SPEC §10): scene, navigation, nav cube, view control bar. With `plan` the same
 * editable scene is seen straight from above in parallel projection (2D working view): every
 * tool, grip, snap and the inspector keep working; a storey selector shows the dwellings and
 * rooms of one storey, or the whole model from above (roofs).
 */
export function Viewport3D({ plan = false }: { plan?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const analysis = useAnalysis();
  const style = useUiStore((s) => s.visualStyle);
  const projection = useUiStore((s) => s.projection);
  const sun = useViewportStore((s) => (plan ? s.planSun : s.sunEnabled));
  const look = useLook();
  const solids = analysis?.result.solids ?? EMPTY;
  const shadows = LIT_STYLES.has(style) && sun;
  // dwelling layouts (outdoor spaces, granulometry): recomputed with every change of the project
  const layouts = useMemo(() => {
    if (!project || !analysis) return null;
    try {
      return massLayouts(analysis.result, project.settings);
    } catch (e) {
      console.error('layout failed', e);
      return null;
    }
  }, [project, analysis]);
  // storey cut: the chosen storey, kept within the storeys of the model
  const cutLevel = useViewportStore((s) => (plan ? s.planLevel : s.cutLevel));
  const setCutLevel = useViewportStore((s) => (plan ? s.setPlanLevel : s.setCutLevel));
  const levels = useMemo(() => cutLevels(solids.map((r) => r.solid)), [solids]);
  const cut =
    cutLevel === null || !levels.length
      ? null
      : Math.min(levels[0]!, Math.max(levels[levels.length - 1]!, cutLevel));
  if (!project) return null;
  const basements = Math.max(0, -Math.min(0, ...levels));
  const labelOf = (l: number) => storeyLabel(l, project.settings.notation, false, basements);
  const ortho = plan || projection === 'orthographic';
  return (
    <div className={`vp-root${plan ? ' is-plan' : ''}`}>
      <Canvas
        key={plan ? 'plan' : projection}
        className="vp-canvas"
        orthographic={ortho}
        shadows={shadows ? 'percentage' : false}
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
        <Lights project={project} solids={solids} style={style} shadows={shadows} look={look} />
        <SceneContent
          project={project}
          solids={solids}
          roofs={analysis?.result.roofs}
          style={style}
          shadows={shadows}
          layouts={layouts}
          cutLevel={cut}
        />
        <CameraRig project={project} solids={solids} projection={projection} plan={plan} />
        {plan && <PlanScaleProbe />}
        <ToolLayer />
        <Effects look={look} style={style} />
      </Canvas>
      <div
        className="vp-labels"
        ref={(el) => {
          labelLayerRef.current = el;
        }}
      />
      {plan ? <PlanOverlay /> : <NavCube />}
      <ViewControlBar plan={plan} />
      {style === 'consistentColors' && <UsageLegend />}
      {plan && levels.length > 0 ? (
        <CutSlider
          levels={levels}
          labelOf={labelOf}
          value={
            cut === null
              ? null
              : levels.includes(cut)
                ? cut
                : (levels.find((l) => l <= cut) ?? levels[0]!)
          }
          onChange={setCutLevel}
          withRoof
        />
      ) : (
        cut !== null && (
          <CutSlider
            levels={levels}
            labelOf={labelOf}
            value={levels.includes(cut) ? cut : (levels.find((l) => l <= cut) ?? levels[0]!)}
            onChange={setCutLevel}
            onClose={() => setCutLevel(null)}
          />
        )
      )}
      {(style === 'granulometry' || cut !== null) && (
        <GranulometryLegend
          layouts={layouts ?? []}
          mix={project.settings.unitMix}
          level={cut}
          levelLabel={cut === null ? undefined : labelOf(cut)}
        />
      )}
    </div>
  );
}
