import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { House } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoxGeometry, CanvasTexture, SRGBColorSpace, Vector3 } from 'three';
import { cubeRegion, type V3 } from './scene/cameraFit';
import { controlsRef } from './scene/controlsRef';
import { palette } from '../theme/palette';
import { useViewportStore } from './viewportStore';

/** Redraws the nav cube; called by the main view on each of its frames (camera moved). */
export const navCubeInvalidate: { current: (() => void) | null } = { current: null };

function labelTexture(text: string, rotate180 = false): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#fafafa';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#e4e4e7';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 125, 125);
    g.translate(64, 64);
    if (rotate180) g.rotate(Math.PI);
    g.fillStyle = '#52525b';
    const size = text.length > 6 ? 20 : 24;
    g.font = `600 ${size}px 'Inter Variable', system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Animate the main camera to look from `dir` at the current target. */
export function viewFrom(dir: V3) {
  const c = controlsRef.current;
  if (!c) return;
  const t = c.getTarget(new Vector3());
  const dist = c.camera.position.distanceTo(t);
  const d = new Vector3(...dir);
  // pure top / bottom: keep north up
  if (d.x === 0 && d.y === 0) d.y = -1e-3;
  d.normalize().multiplyScalar(dist);
  void c.setLookAt(t.x + d.x, t.y + d.y, t.z + d.z, t.x, t.y, t.z, true);
}

function CubeScene() {
  const { t, i18n } = useTranslation('viewport');
  const [hot, setHot] = useState<V3 | null>(null);
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z. The cube is rotated +90° about x, so
  // local +y = up, local +z = south.
  const textures = useMemo(
    () => [
      labelTexture(t('cube.east')),
      labelTexture(t('cube.west')),
      labelTexture(t('cube.top')),
      labelTexture(t('cube.bottom')),
      labelTexture(t('cube.south')),
      labelTexture(t('cube.north')),
    ],
    [t, i18n.language],
  );
  const letters = useMemo(
    () =>
      (['N', 'E', 'S', 'W'] as const).map((k) => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        if (g) {
          g.fillStyle = k === 'N' ? palette.accent : '#71717a';
          g.font = "700 36px 'Inter Variable', system-ui, sans-serif";
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(t(`compass.${k}`), 32, 34);
        }
        const tex = new CanvasTexture(c);
        tex.colorSpace = SRGBColorSpace;
        return tex;
      }),
    [t, i18n.language],
  );
  useEffect(() => () => [...textures, ...letters].forEach((x) => x.dispose()), [textures, letters]);

  const box = useMemo(() => new BoxGeometry(1.002, 1.002, 1.002), []);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    navCubeInvalidate.current = invalidate;
    return () => {
      if (navCubeInvalidate.current === invalidate) navCubeInvalidate.current = null;
    };
  }, [invalidate]);
  useFrame(({ camera }) => {
    const c = controlsRef.current;
    if (!c) return;
    camera.quaternion.copy(c.camera.quaternion);
    camera.position.set(0, 0, 3.7).applyQuaternion(camera.quaternion);
  });

  const region = (e: ThreeEvent<PointerEvent | MouseEvent>): V3 =>
    cubeRegion([e.point.x, e.point.y, e.point.z]);
  const same = (a: V3 | null, b: V3) => !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  const hl = hot
    ? {
        pos: hot.map((c) => (c === 0 ? 0 : c * 0.425)) as V3,
        size: hot.map((c) => (c === 0 ? 0.68 : 0.17)) as V3,
      }
    : null;

  const compass: [string, V3][] = [
    ['N', [0, 1.05, 0]],
    ['E', [1.05, 0, 0]],
    ['S', [0, -1.05, 0]],
    ['W', [-1.05, 0, 0]],
  ];
  return (
    <group>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const r = region(e);
          if (!same(hot, r)) setHot(r);
        }}
        onPointerOut={() => setHot(null)}
        onClick={(e) => {
          e.stopPropagation();
          viewFrom(region(e));
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        {textures.map((tex, i) => (
          <meshBasicMaterial key={i} attach={`material-${i}`} map={tex} />
        ))}
      </mesh>
      {hl && (
        <mesh position={hl.pos} raycast={() => null}>
          <boxGeometry args={[hl.size[0] + 0.01, hl.size[1] + 0.01, hl.size[2] + 0.01]} />
          <meshBasicMaterial color={palette.accent} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
      <lineSegments raycast={() => null}>
        <edgesGeometry args={[box]} />
        <lineBasicMaterial color="#a1a1aa" />
      </lineSegments>
      <mesh position={[0, 0, -0.55]} raycast={() => null}>
        <ringGeometry args={[0.86, 0.93, 48]} />
        <meshBasicMaterial color="#a1a1aa" transparent opacity={0.6} />
      </mesh>
      {compass.map(([k, p], i) => (
        <sprite
          key={k}
          position={[p[0], p[1], -0.55]}
          scale={[0.3, 0.3, 0.3]}
          onClick={(e) => {
            e.stopPropagation();
            viewFrom([p[0] > 0 ? 1 : p[0] < 0 ? -1 : 0, p[1] > 0 ? 1 : p[1] < 0 ? -1 : 0, 0]);
          }}
        >
          <spriteMaterial map={letters[i]} transparent />
        </sprite>
      ))}
    </group>
  );
}

/** Navigation cube overlay (top-right): faces, edges, corners, compass, Home. */
export function NavCube() {
  const { t } = useTranslation('viewport');
  const requestHome = useViewportStore((s) => s.requestHome);
  return (
    <div className="vp-navcube">
      <button
        type="button"
        className="vp-navcube-home"
        title={t('cube.home')}
        aria-label={t('cube.home')}
        onClick={requestHome}
      >
        <House size={15} strokeWidth={1.75} />
      </button>
      <Canvas
        // drawn only when the main view moves (see navCubeInvalidate), not 60× per second
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: 34, position: [0, 0, 3.7], up: [0, 0, 1] }}
      >
        <CubeScene />
      </Canvas>
    </div>
  );
}
