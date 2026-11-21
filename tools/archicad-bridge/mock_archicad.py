#!/usr/bin/env python3
"""In-memory imitation of Archicad's JSON API with the Tapir commands Kubatur uses.

For tests and for trying the web app without Archicad:

    python mock_archicad.py              # listens on 127.0.0.1:19723
    python mock_archicad.py --refuse-zones   # behaves like a project whose zone stamp is missing

Shapes follow Tapir 2.0.0 (docs/archicad-addon/command_definitions.js). Required fields
are checked; every call is appended to `log`.
"""

from __future__ import annotations

import argparse
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def _guid() -> str:
    return str(uuid.uuid4()).upper()


DEFAULT_STORIES = [
    {"index": -1, "name": "R-1", "level": -3.0, "height": 3.0},
    {"index": 0, "name": "RDC", "level": 0.0, "height": 3.5},
    {"index": 1, "name": "R+1", "level": 3.5, "height": 3.0},
    {"index": 2, "name": "R+2", "level": 6.5, "height": 3.0},
]


class MockArchicad:
    def __init__(self, refuse_zones: bool = False, stories: list[dict[str, Any]] | None = None) -> None:
        self.refuse_zones = refuse_zones
        self.stories = [dict(s) for s in (stories or DEFAULT_STORIES)]
        self.elements: dict[str, dict[str, Any]] = {}
        self.user_data: dict[str, dict[str, str]] = {}
        self.attributes: dict[str, list[dict[str, Any]]] = {
            "Layer": [
                {"attributeId": {"guid": _guid()}, "index": 1, "name": "Calque Archicad"},
                {"attributeId": {"guid": _guid()}, "index": 2, "name": "8 - ZONES_SDP"},
            ],
            "ZoneCategory": [{"attributeId": {"guid": _guid()}, "index": 1, "name": "Zone"}],
        }
        self.zone_default_layer = self.attributes["Layer"][1]["attributeId"]["guid"]
        self.untitled = True
        self.log: list[tuple[str, Any]] = []
        self.lock = threading.Lock()

    # -- helpers -----------------------------------------------------------
    def add_foreign(self, kind: str) -> str:
        """An element Kubatur did not create (for guard tests)."""
        g = _guid()
        self.elements[g] = {"type": kind}
        return g

    def _require(self, obj: dict[str, Any], *keys: str) -> None:
        for k in keys:
            if k not in obj:
                raise ValueError(f"missing required field '{k}'")

    def _floor_ok(self, idx: Any) -> None:
        if not any(s["index"] == idx for s in self.stories):
            raise ValueError(f"invalid floor index {idx}")

    def _create_attrs(self, kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        out = []
        for it in items:
            self._require(it, "name")
            idx = max([a["index"] for a in self.attributes[kind]] + [0]) + 1
            a = {"attributeId": {"guid": _guid()}, "index": idx, "name": it["name"]}
            self.attributes[kind].append(a)
            out.append({"attributeId": a["attributeId"]})
        return {"attributeIds": out}

    def _create(self, kind: str, items: list[dict[str, Any]], check) -> dict[str, Any]:
        out = []
        for it in items:
            try:
                check(it)
            except ValueError as e:
                out.append({"error": {"code": -2130313112, "message": str(e)}})
                continue
            g = _guid()
            self.elements[g] = {"type": kind, "data": it}
            out.append({"elementId": {"guid": g}})
        return {"elements": out}

    # -- commands ----------------------------------------------------------
    def tapir(self, name: str, p: dict[str, Any]) -> Any:
        if name == "GetAddOnVersion":
            return {"version": "2.0.0"}
        if name == "GetProjectInfo":
            return {"isUntitled": self.untitled, "isTeamwork": False}
        if name == "GetLayerOfElementDefaults":
            name_of = {a["attributeId"]["guid"]: a["name"] for a in self.attributes["Layer"]}
            return {
                "layersOfElementDefaults": [
                    {"elementType": t, "layerId": {"guid": self.zone_default_layer}, "layerName": name_of.get(self.zone_default_layer, "")}
                    for t in p["elementTypes"]
                ]
            }
        if name == "SetLayerOfElementDefaults":
            for it in p["layersOfElementDefaults"]:
                if it["elementType"] == "Zone":
                    self.zone_default_layer = it["layerId"]["guid"]
            return {"executionResults": [{"success": True} for _ in p["layersOfElementDefaults"]]}
        if name == "SetStories":
            base = p["stories"][0].get("index", self.stories[0]["index"]) if p["stories"] else 0
            self.stories = [
                {"index": base + i, "name": s["name"], "level": s["level"], "height": 3.0} for i, s in enumerate(p["stories"])
            ]
            return {}
        if name == "GetStories":
            return {"firstStory": self.stories[0]["index"], "lastStory": self.stories[-1]["index"], "actStory": 0, "stories": self.stories}
        if name == "GetLibraries":
            return {"libraries": [{"name": "Bibliothèque Archicad 28", "type": "LocalLibrary", "available": not self.refuse_zones}]}
        if name == "GetAttributesByType":
            self._require(p, "attributeType")
            return {"attributes": self.attributes.get(p["attributeType"], [])}
        if name == "CreateLayers":
            return self._create_attrs("Layer", p["layerDataArray"])
        if name == "CreateZoneCategories":
            return self._create_attrs("ZoneCategory", p["zoneCategoryDataArray"])
        if name == "GetElementsByType":
            self._require(p, "elementType")
            return {"elements": [{"elementId": {"guid": g}} for g, e in self.elements.items() if e["type"] == p["elementType"]]}
        if name == "CreateZones":
            def check(z: dict[str, Any]) -> None:
                self._require(z, "name", "numberStr", "geometry")
                self._require(z["geometry"], "polygonCoordinates")
                self._floor_ok(z.get("floorIndex", 0))
                if self.refuse_zones:
                    raise ValueError("Failed to create new Zone")
            return self._create("Zone", p["zonesData"], check)
        if name == "CreateSlabs":
            def check(s: dict[str, Any]) -> None:
                self._require(s, "level", "polygonCoordinates")
                self._floor_ok(s.get("floorIndex", 0))
            return self._create("Slab", p["slabsData"], check)
        if name == "CreateMorphs":
            def check(m: dict[str, Any]) -> None:
                self._require(m, "basePoint")
                if ("body" in m) == ("size" in m):
                    raise ValueError("give exactly one of size and body")
                if "body" in m:
                    n = len(m["body"]["vertices"])
                    for poly in m["body"].get("polygons", []):
                        if any(not 0 <= v < n for v in poly["vertexIds"]):
                            raise ValueError("vertex index out of range")
            return self._create("Morph", p["morphsData"], check)
        if name == "SetElementUserData":
            res = []
            for it in p["elementUserData"]:
                g = it["elementId"]["guid"]
                if g not in self.elements:
                    res.append({"success": False, "error": {"code": 1, "message": "not found"}})
                    continue
                d = self.user_data.setdefault(g, {})
                for pair in it.get("userData", []):
                    d[pair["key"]] = pair["value"]
                res.append({"success": True})
            return {"executionResults": res}
        if name == "GetElementUserData":
            keys = p.get("keys")
            out = []
            for it in p["elements"]:
                g = it["elementId"]["guid"]
                if g not in self.elements:
                    out.append({"error": {"code": 1, "message": "not found"}})
                    continue
                d = self.user_data.get(g, {})
                out.append({"userData": [{"key": k, "value": v} for k, v in d.items() if keys is None or k in keys]})
            return {"elementUserData": out}
        if name == "SetDetailsOfElements":
            res = []
            for it in p["elementsWithDetails"]:
                g = it["elementId"]["guid"]
                if g in self.elements:
                    self.elements[g].setdefault("details", {}).update(it["details"])
                res.append({"success": g in self.elements})
            return {"executionResults": res}
        if name == "DeleteElements":
            res = []
            for it in p["elements"]:
                g = it["elementId"]["guid"]
                ok = g in self.elements
                if ok and not p.get("dryRun"):
                    self.elements.pop(g)
                    self.user_data.pop(g, None)
                res.append({"success": ok})
            return {"executionResults": res}
        raise KeyError(name)

    def handle(self, body: dict[str, Any]) -> dict[str, Any]:
        command = body.get("command")
        params = body.get("parameters") or {}
        with self.lock:
            if command == "API.IsAlive":
                return {"succeeded": True, "result": {"isAlive": True}}
            if command == "API.GetProductInfo":
                return {"succeeded": True, "result": {"version": 28, "buildNumber": 3110, "languageCode": "INT"}}
            if command != "API.ExecuteAddOnCommand":
                return {"succeeded": False, "error": {"code": 4001, "message": f"Unknown command {command}"}}
            cid = params.get("addOnCommandId", {})
            if cid.get("commandNamespace") != "TapirCommand":
                return {"succeeded": False, "error": {"code": 4002, "message": "unknown add-on"}}
            name = cid.get("commandName")
            args = params.get("addOnCommandParameters") or {}
            self.log.append((name, args))
            try:
                response = self.tapir(name, args)
            except KeyError:
                response = {"error": {"code": 4003, "message": f"mock does not implement {name}"}}
            except (ValueError, TypeError) as e:
                response = {"error": {"code": 4004, "message": f"schema: {e}"}}
            return {"succeeded": True, "result": {"addOnCommandResponse": response}}


def serve(mock: MockArchicad, port: int = 19723) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a: Any) -> None:
            pass

        def do_POST(self) -> None:  # noqa: N802
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n).decode("utf-8"))
                answer = mock.handle(body)
            except json.JSONDecodeError:
                answer = {"succeeded": False, "error": {"code": 2001, "message": "Request format error (invalid JSON format)"}}
            data = json.dumps(answer).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=19723)
    ap.add_argument("--refuse-zones", action="store_true")
    a = ap.parse_args()
    srv = serve(MockArchicad(refuse_zones=a.refuse_zones), a.port)
    print(f"Mock Archicad on http://127.0.0.1:{a.port}")
    srv.serve_forever()
