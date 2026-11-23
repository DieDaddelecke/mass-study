# Leitfaden Wohnungsgrundrisse (Règles de plan des logements)

Stand: 23.11.2026, mit Soheyl abgestimmt. Profil Frankreich. Diese Regeln steuern den
schematischen Grundriss-Generator (`packages/core/src/rooms.ts`, `layout.ts`). Alle Zahlen
sollen in den Einstellungen änderbar sein, mit den Werten hier als Vorgabe.

Begriffe: Séjour = Wohnraum, Chambre = Zimmer, Chambre PMR = barrierefreies Zimmer,
SDB = Salle de bain, SDE = Salle d'eau, Entrée = Eingangsbereich/Flur.

## 1. Fassadenbreiten (bestehende Büro-Regeln)

| Raum | Mindest-Fassade |
|---|---|
| Séjour | 3,60 m |
| Chambre PMR (jede Wohnung ab T2, genau eine) | 2,80 m |
| weitere Chambres (T3: 1, T4: 2, T5: 3) | 2,50 m |
| Cuisine, wenn separat | 2,15 m |
| Wand zwischen Räumen | ≥ 0,10 m |

Die Laubengang-Seite zählt als Fassade (umschaltbar).

## 2. Mindestflächen

| Raum | Mindestfläche |
|---|---|
| Séjour (ohne Küche) | 20 m² |
| Séjour + Cuisine (offen) | 25 m² |
| Cuisine separat | 7 m² |
| Chambre | 10 m² |
| Chambre PMR | 12 m² |
| SDB | 5 m² |
| SDE | 4 m² |
| WC | 2 m² |

## 3. Zonierung

- **Tageszone** (Entrée, Cuisine, Séjour) liegt am Wohnungseingang.
- **Nachtzone** (Chambres, Bad) liegt gebündelt am anderen Ende. Zu den Zimmern geht man
  nicht durch den Séjour.
- **Entrée:** ab T2 immer ein Eingangsbereich bzw. Flur. Ein kleines T2 darf direkt in den
  Séjour erschlossen werden, ein T1 ebenfalls.
- **Reihenfolge entlang der Fassade:** Séjour → Chambre PMR (nah an Bad und Eingang) →
  weitere Chambres.

## 4. Séjour

- Bei Eckwohnungen liegt der Séjour in der Ecke (Fassade auf zwei Seiten).
- Danach nach Himmelsrichtung: **Süd > West > Ost > Nord**.
- Bei durchgehenden Wohnungen (traversant) geht der Séjour durch.
- Die Séjours und vor allem Loggien und Balkone liegen **übereinander**, damit ein
  ruhiges Fassadenbild entsteht. An Rücksprüngen (z. B. Gradient) darf das wechseln.

## 5. Orientierung

- **Ab T3 hat jede Wohnung mindestens zwei Ausrichtungen.** Lässt das Volumen das nicht zu,
  braucht es größere Rücksprünge oder durchgehende Wohnungen. Der Generator meldet solche
  Wohnungen als Verstoß.
- Reine Nordwohnungen mit nur einer Ausrichtung sind verboten, auch bei T1 und T2.

## 6. Küche

- T1 und T2: offen im Séjour.
- Ab T3: offen oder abtrennbar, immer direkt am Séjour.
- Innenliegend (ohne Fenster) erlaubt, wenn sie zum Séjour offen ist.
- Separate Küche: an der Fassade, mindestens 2,15 m.

## 7. Bäder und WC

| Typ | Nasszellen |
|---|---|
| T1, T2 | 1 SDB mit WC |
| T3 | 1 SDB + 1 WC separat |
| T4, T5 | 1 SDB + 1 SDE + 1 WC separat |

- Bäder dürfen innenliegend sein (VMC).
- SDB und WC sind PMR-gerecht und liegen neben der Chambre PMR.

## 8. Schächte (gaines)

- Jede Wohnung hat **einen eigenen Schacht, 60 × 60 cm**. Zwei Wohnungen teilen sich nie
  einen Schacht.
- Küche, SDB, SDE und WC einer Wohnung liegen an diesem Schacht.
- Schächte laufen senkrecht durch alle Geschosse.
- Über einem Wohn- oder Schlafraum der Wohnung darunter liegt keine Nasszelle.

## 9. Lage in der Wohnungstiefe

- Fassade: Séjour und Chambres (und eine separate Küche).
- Innenzone, zwischen Erschließung und Wohnräumen: Entrée, SDB, SDE, WC, Schacht und
  innenliegende Küche.
- Rangements (Placard, Cellier) werden nicht geplant.

## 10. Laubengang

- Zum Laubengang liegen Entrée, Küche und Bad, keine Schlafzimmer.
- Keine weitere Regel für einen Séjour am Laubengang.

## 11. Erschließung und Verteilung

- Wohnungen pro Treppenhaus und Geschoss: **einstellbar, mindestens 3, höchstens 8**.
- Große Wohnungen (T4, T5) an die Ecken, kleine (T1, T2) in die Mitte.
- Nachbarwohnungen werden gespiegelt: Séjour an Séjour, Zimmer an Zimmer (Schallschutz).

## 12. Stapelung

- Wohnungstrennwände und Schächte liegen über alle Geschosse übereinander, nach
  Möglichkeit auch derselbe Wohnungstyp.
- An Rücksprüngen darf davon abgewichen werden.

## 13. Außenräume

- Ein Außenraum pro Wohnung, am Séjour, mindestens 4 m² (Loggia ≥ 1,80 m tief,
  Balkon ≥ 1,40 m). Keine Staffelung nach Typ, kein zweiter Außenraum.

## Offene Punkte

- Maximale Länge eines Innenflurs (couloir) ist noch nicht festgelegt.
- Zweispänner haben heute fest 2 Wohnungen pro Treppenhaus. Gilt die Spanne 3 bis 8 für
  alle Erschließungsarten oder nur für Mittelflur und Punkthaus?
- Auswertung der Beispielpläne des Büros steht noch aus.
