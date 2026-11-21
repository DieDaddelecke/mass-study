import { useEffect, useMemo } from 'react';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

interface Props {
  segments: readonly number[];
  color: string;
  /** Line width in pixels. */
  width?: number;
  opacity?: number;
  depthTest?: boolean;
  renderOrder?: number;
}

/** Screen-space thick line segments (LineSegments2), e.g. silhouettes and outlines. */
export function FatSegments({
  segments,
  color,
  width = 2,
  opacity = 1,
  depthTest = true,
  renderOrder = 0,
}: Props) {
  const obj = useMemo(() => {
    const g = new LineSegmentsGeometry();
    if (segments.length) g.setPositions(new Float32Array(segments));
    const m = new LineMaterial({ linewidth: width, transparent: opacity < 1, opacity, depthTest });
    const l = new LineSegments2(g, m);
    l.renderOrder = renderOrder;
    return l;
  }, [segments, width, opacity, depthTest, renderOrder]);
  useEffect(() => {
    obj.material.color.set(color);
  }, [obj, color]);
  useEffect(
    () => () => {
      obj.geometry.dispose();
      obj.material.dispose();
    },
    [obj],
  );
  if (!segments.length) return null;
  return <primitive object={obj} />;
}
