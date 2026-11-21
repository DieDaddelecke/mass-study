# Synthetic fixtures

Hand-written, NOT recorded from a real service. Used to test generic code paths that have no
verified live endpoint yet.

- `synthetic-wfs-parcels.json`: GeoJSON FeatureCollection as a generic WFS 2.0 (`OUTPUTFORMAT=application/json`)
  would return it, with ALKIS-like field names (`flstkennz`, `gemarkung`, `flstnrzae`, `amtlflsfl`).
- `synthetic-nominatim.json`: Nominatim `format=jsonv2` search answer (shape per Nominatim docs).
- `empty-features.json`: empty FeatureCollection (geocoder without results).
- `overpass-green.json`: **synthetic** Overpass `[out:json]` / `out geom` answer for the Palaiseau
  bbox (the real request could not be recorded: Overpass and both mirrors were overloaded, see
  `palaiseau/raw/summary.json`). Contains 4 `natural=tree` nodes (with/without `height`,
  `est_height`, `diameter_crown`, `leaf_type`), a `natural=tree_row` way (~73 m), a `leisure=park`
  way, a `landuse=grass` way and a `natural=wood` multipolygon relation whose outer ring is split
  into two ways plus one inner ring. Element ids ≥ 9 000 000 000 are fake.
