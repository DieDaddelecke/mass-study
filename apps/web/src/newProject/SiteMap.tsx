import {
  GeoJSONSource,
  Map as MlMap,
  Marker,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre resolves its worker relative to its own module, which breaks under Vite's dependency
// pre-bundling; let Vite bundle the worker and hand MapLibre the URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import type { LonLat, LonLatRings } from '../api/contract';

setWorkerUrl(workerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Fallback when the vector style cannot be loaded (offline): plain background. */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eceae4' } }],
};

export interface MapParcel {
  ref: string;
  polygons: LonLatRings[];
  selected: boolean;
}

export interface SiteMapProps {
  /** Fly to this position whenever `seq` changes. */
  focus: { lonLat: LonLat; zoom: number; seq: number } | null;
  marker: LonLat | null;
  parcels: MapParcel[];
  /** Site outline (drawn / imported). */
  site: LonLatRings[];
  /** Polygon being drawn. */
  draft: LonLat[];
  drawing: boolean;
  onClick: (lonLat: LonLat) => void;
  onDoubleClick: (lonLat: LonLat) => void;
  onCenterChange: (lonLat: LonLat) => void;
}

type Geometry =
  | { type: 'Point'; coordinates: LonLat }
  | { type: 'LineString'; coordinates: LonLat[] }
  | { type: 'Polygon'; coordinates: LonLatRings };
interface Feature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: Geometry;
}
interface FC {
  type: 'FeatureCollection';
  features: Feature[];
}
const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features });
const polyFeature = (rings: LonLatRings, properties: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: rings },
});

function parcelsData(parcels: MapParcel[]): FC {
  return fc(
    parcels.flatMap((p) => p.polygons.map((r) => polyFeature(r, { ref: p.ref, sel: p.selected }))),
  );
}
function siteData(site: LonLatRings[]): FC {
  return fc(site.map((r) => polyFeature(r)));
}
function draftData(draft: LonLat[]): FC {
  const features: Feature[] = draft.map((c) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: c },
  }));
  if (draft.length >= 2)
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: draft },
    });
  return fc(features);
}

/** MapLibre map for site selection. Isolated so tests can mock it (no WebGL in jsdom). */
export function SiteMap(props: SiteMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!el.current) return;
    let map: MlMap;
    try {
      map = new MlMap({
        container: el.current,
        style: MAP_STYLE,
        center: [2.35, 46.6],
        zoom: 5,
        attributionControl: { compact: true },
      });
    } catch (e) {
      console.warn('map unavailable', e);
      return;
    }
    mapRef.current = map;
    let fellBack = false;
    map.on('error', () => {
      // style / tiles unreachable: fall back to a blank style so overlays still work
      if (!fellBack && !map.isStyleLoaded()) {
        fellBack = true;
        map.setStyle(BLANK_STYLE);
      }
    });
    const setup = () => {
      const p = propsRef.current;
      const add = (id: string, data: FC) => {
        if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
      };
      add('np-parcels', parcelsData(p.parcels));
      add('np-site', siteData(p.site));
      add('np-draft', draftData(p.draft));
      const layer = (spec: Parameters<MlMap['addLayer']>[0]) => {
        if (!map.getLayer(spec.id)) map.addLayer(spec);
      };
      layer({
        id: 'np-parcels-fill',
        type: 'fill',
        source: 'np-parcels',
        paint: {
          'fill-color': ['case', ['get', 'sel'], '#2f8be6', '#e8a600'],
          'fill-opacity': ['case', ['get', 'sel'], 0.35, 0.12],
        },
      });
      layer({
        id: 'np-parcels-line',
        type: 'line',
        source: 'np-parcels',
        paint: {
          'line-color': ['case', ['get', 'sel'], '#1559d6', '#b07d00'],
          'line-width': ['case', ['get', 'sel'], 2, 1],
        },
      });
      layer({
        id: 'np-site-fill',
        type: 'fill',
        source: 'np-site',
        paint: { 'fill-color': '#2f8be6', 'fill-opacity': 0.3 },
      });
      layer({
        id: 'np-site-line',
        type: 'line',
        source: 'np-site',
        paint: { 'line-color': '#1559d6', 'line-width': 2 },
      });
      layer({
        id: 'np-draft-line',
        type: 'line',
        source: 'np-draft',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#d23b2f', 'line-width': 2, 'line-dasharray': [2, 1] },
      });
      layer({
        id: 'np-draft-pts',
        type: 'circle',
        source: 'np-draft',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#fff',
          'circle-stroke-color': '#d23b2f',
          'circle-stroke-width': 2,
        },
      });
    };
    map.on('style.load', setup);
    map.on('click', (e) => propsRef.current.onClick([e.lngLat.lng, e.lngLat.lat]));
    map.on('dblclick', (e) => {
      if (propsRef.current.drawing) e.preventDefault();
      propsRef.current.onDoubleClick([e.lngLat.lng, e.lngLat.lat]);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      propsRef.current.onCenterChange([c.lng, c.lat]);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  const setData = (id: string, data: FC) => {
    const src = mapRef.current?.getSource(id);
    if (src instanceof GeoJSONSource) src.setData(data);
  };
  useEffect(() => setData('np-parcels', parcelsData(props.parcels)), [props.parcels]);
  useEffect(() => setData('np-site', siteData(props.site)), [props.site]);
  useEffect(() => setData('np-draft', draftData(props.draft)), [props.draft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (props.drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = props.drawing ? 'crosshair' : '';
  }, [props.drawing]);

  const seq = props.focus?.seq;
  useEffect(() => {
    const f = propsRef.current.focus;
    if (f) mapRef.current?.flyTo({ center: f.lonLat, zoom: f.zoom, duration: 1200 });
  }, [seq]);

  const markerKey = props.marker?.join(',');
  useEffect(() => {
    const map = mapRef.current;
    const m = propsRef.current.marker;
    if (!map) return;
    if (!m) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current)
      markerRef.current = new Marker({ color: '#d23b2f' }).setLngLat(m).addTo(map);
    else markerRef.current.setLngLat(m);
  }, [markerKey]);

  return <div ref={el} className="np-map" data-testid="site-map" />;
}
