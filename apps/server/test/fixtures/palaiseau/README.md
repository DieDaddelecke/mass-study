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
