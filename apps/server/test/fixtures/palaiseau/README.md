# Palaiseau fixtures

Real responses recorded on 2026-11-21 for the test site 27 Boulevard Thomas Gobert, 91120 Palaiseau
(parcel 0H 0518). Recorded in a browser because the CI/dev container cannot reach these services.
Large responses are trimmed (subset of features / properties, coordinates rounded to 1e-7°, a few
saw-tooth vertices of batiment.16296576 dropped); the
structure is unchanged.

| File                   | Request                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geocode.json`         | `GET https://data.geopf.fr/geocodage/search?q=27 Bd Thomas Gobert 91120 Palaiseau&limit=5`                                                                                                                                                                    |
| `completion.json`      | `GET https://data.geopf.fr/geocodage/completion?text=27 bd thomas gob&type=StreetAddress&maximumResponses=5`                                                                                                                                                  |
| `parcel-0518.json`     | `GET https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[2.197965,48.713064]}`                                                                                                                                                  |
| `parcel-0519.json`     | same with point `[2.1990,48.7128]` (neighbouring parcel)                                                                                                                                                                                                      |
| `bdtopo-batiment.json` | `GET https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=1000&BBOX=48.71155,2.19626,48.71425,2.20034,urn:ogc:def:crs:EPSG::4326` (6 of 14 features) |
| `overpass.json`        | `POST https://overpass-api.de/api/interpreter` with `[out:json][timeout:25];(way["building"](bbox);relation["building"](bbox);way["building:part"](bbox););out geom;` (5 of 18 elements)                                                                      |

Notes from the real data:

- BD TOPO: `hauteur` may be `null`; z = `-1000` marks unknown altitude; MultiPolygons with holes occur;
  `etat_de_l_objet` can be `"En construction"`.
- Overpass: multipolygon relations come with `members[].geometry` (`out geom`); `building:part` ways exist.
- The existing student residence on parcel 0518 is OSM way 626590677 (5 levels) and BD TOPO batiment.16296576 (16.8 m).

## `raw/` — context layers (recorded 2026-11-21, untrimmed)

Real, **untrimmed** responses for the bbox `2.1962385,48.7115536,2.2003227,48.7142486` recorded with
`scripts/record-context-fixtures.mjs`. `raw/summary.json` lists the exact URL, HTTP status, content
type, byte size, feature count and first properties of each file — keep the files as they are.

| File                                  | Request / content                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bdtopo-troncon_de_route.json`        | IGN WFS `BDTOPO_V3:troncon_de_route` (34 road segments, LineString with z)                          |
| `bdtopo-zone_de_vegetation.json`      | IGN WFS `BDTOPO_V3:zone_de_vegetation` (2: forêt fermée de feuillus, haie)                          |
| `bdtopo-haie.json`                    | IGN WFS `BDTOPO_V3:haie` (empty)                                                                    |
| `bdtopo-surface_hydrographique.json`  | IGN WFS `BDTOPO_V3:surface_hydrographique` (empty)                                                  |
| `bdtopo-equipement_de_transport.json` | IGN WFS `BDTOPO_V3:equipement_de_transport` (1 parking; not used yet)                               |
| `wfs-parcellaire_express.json`        | IGN WFS `CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle` (22 parcels; fallback for API Carto)        |
| `apicarto-parcelles-bbox.json`        | API Carto cadastre `?geom=<bbox Polygon>&_limit=1000` (21 parcels)                                  |
| `overpass-streets.json`               | Overpass POST: `highway`, `railway`, `area:highway`, `natural=water`, `waterway` ways (50 elements) |
| `tile-planign.png`                    | IGN WMTS `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`, PM z18 x132672 y90343 (image/png)                     |
| `tile-ortho.jpg`                      | IGN WMTS `ORTHOIMAGERY.ORTHOPHOTOS`, same tile (image/jpeg)                                         |
| `tile-openfreemap-style.json`         | OpenFreeMap "liberty" style (not used by the server)                                                |

The OSM green / tree request (`overpass-green.json`) failed with 502/504 on all three Overpass
endpoints (see `summary.json`); tests use the hand-made `../synthetic/overpass-green.json` instead.
