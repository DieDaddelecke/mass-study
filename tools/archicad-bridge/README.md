# Kubatur Archicad bridge

Lokaler Helfer zwischen der Kubatur-Web-App und Archicad (Tapir-Add-on). Python ≥ 3.10, nur Standardbibliothek.

```bash
python bridge.py                 # 127.0.0.1:19780, zeigt den Pairing-Code
python mock_archicad.py          # Archicad-Attrappe auf :19723 (Tests/Demo)
python -m unittest discover -s . # Tests
```

Einrichtung, Sicherheitsregeln und Verhalten: [docs/ARCHICAD.md](../../docs/ARCHICAD.md).
