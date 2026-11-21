# Synthetic fixtures

Hand-written, NOT recorded from a real service. Used to test generic code paths that have no
verified live endpoint yet.

- `synthetic-wfs-parcels.json`: GeoJSON FeatureCollection as a generic WFS 2.0 (`OUTPUTFORMAT=application/json`)
  would return it, with ALKIS-like field names (`flstkennz`, `gemarkung`, `flstnrzae`, `amtlflsfl`).
- `synthetic-nominatim.json`: Nominatim `format=jsonv2` search answer (shape per Nominatim docs).
- `empty-features.json`: empty FeatureCollection (geocoder without results).
