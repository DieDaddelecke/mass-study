#!/usr/bin/env python3
"""Kubatur Archicad bridge.

Small local HTTP server that lets the Kubatur web app talk to Archicad's JSON API
(Archicad 25+ with the Tapir add-on). Browsers cannot call Archicad directly:
its JSON API on 127.0.0.1:19723 sends no CORS headers.

Python >= 3.10, standard library only.

    python bridge.py                       # listens on 127.0.0.1:19780
    python bridge.py --origin https://kubatur.example.org

Safety rules enforced here, independent of the web app:
  * binds to 127.0.0.1 only, answers only allowed browser origins, needs the pairing token;
  * only an allow-list of Tapir commands can be called;
  * SetStories only in an untitled (never saved, test) project, and never with fewer stories;
  * the Zone tool's default layer can only be switched to an "MS - " layer and back to the
    layer it had before (zones have no layer parameter in Tapir 2.0);
  * DeleteElements / SetDetailsOfElements only act on elements that carry Kubatur's
    user data (key "kubatur.projectId"), so the bridge can never delete or change
    anything Kubatur did not create;
  * layers and zone categories can only be created with the "MS - " prefix and never
    overwrite existing ones.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

VERSION = "0.2.0"
NAME = "kubatur-archicad-bridge"
DEFAULT_PORT = 19780
ARCHICAD_PORTS = range(19723, 19745)
OWN_KEY = "kubatur.projectId"
NAME_PREFIX = "MS - "

DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

READ_COMMANDS = {
    "GetAddOnVersion",
    "GetProjectInfo",
    "GetStories",
    "GetLibraries",
    "GetElementsByType",
    "GetElementUserData",
    "GetAttributesByType",
    "GetDetailsOfElements",
    "GetZoneCategories",
    "GetLayers",
    "GetGeoLocation",
    "GetSurveyPointTransformation",
    "GetCoordinateOrigins",
    "GetLayerOfElementDefaults",
    "GetAvailableLibraryParts",
}
CREATE_COMMANDS = {
    "CreateZones",
    "CreateSlabs",
    "CreateMorphs",
    "CreateWalls",
    "CreateRoofs",
    "CreateStairs",
    "SetElementUserData",
}
GUARDED_COMMANDS = {
    "DeleteElements",
    "SetDetailsOfElements",
    "CreateLayers",
    "CreateZoneCategories",
    "SetLayerOfElementDefaults",
    "SetStories",
}
API_COMMANDS = {"API.IsAlive", "API.GetProductInfo"}


class BridgeRefusal(Exception):
    """A request the bridge refuses on principle (HTTP 403)."""


class ArchicadError(Exception):
    """Archicad or Tapir answered with an error (HTTP 502)."""


# ---------------------------------------------------------------------------
# Archicad JSON API
# ---------------------------------------------------------------------------


class Archicad:
    def __init__(self, host: str = "127.0.0.1", timeout: float = 120.0) -> None:
        self.host = host
        self.timeout = timeout
        self._lock = threading.Lock()

    def raw(self, port: int, command: str, parameters: Any = None, timeout: float | None = None) -> Any:
        body: dict[str, Any] = {"command": command}
        if parameters is not None:
            body["parameters"] = parameters
        req = urllib.request.Request(
            f"http://{self.host}:{port}",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self._lock:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                answer = json.loads(r.read().decode("utf-8"))
        if not answer.get("succeeded"):
            err = answer.get("error") or {}
            raise ArchicadError(err.get("message") or "Archicad error")
        return answer.get("result")

    def tapir(self, port: int, name: str, parameters: Any = None) -> Any:
        result = self.raw(
            port,
            "API.ExecuteAddOnCommand",
            {
                "addOnCommandId": {"commandNamespace": "TapirCommand", "commandName": name},
                "addOnCommandParameters": parameters if parameters is not None else {},
            },
        )
        response = (result or {}).get("addOnCommandResponse")
        if isinstance(response, dict) and set(response.keys()) == {"error"}:
            raise ArchicadError(response["error"].get("message") or f"{name} failed")
        return response

    def instances(self) -> list[dict[str, Any]]:
        found = []
        for port in ARCHICAD_PORTS:
            try:
                self.raw(port, "API.IsAlive", timeout=0.4)
            except Exception:  # noqa: BLE001 - nothing listening
                continue
            inst: dict[str, Any] = {"port": port}
            try:
                inst["product"] = self.raw(port, "API.GetProductInfo", timeout=5)
            except Exception as e:  # noqa: BLE001
                inst["error"] = str(e)
            try:
                inst["tapirVersion"] = self.tapir(port, "GetAddOnVersion").get("version")
                inst["project"] = self.tapir(port, "GetProjectInfo")
            except Exception:  # noqa: BLE001 - Tapir missing
                inst["tapirVersion"] = None
            found.append(inst)
        return found


# ---------------------------------------------------------------------------
# Command policy
# ---------------------------------------------------------------------------


def _element_ids(items: Any, key: str = "elementId") -> list[dict[str, Any]]:
    out = []
    for it in items or []:
        if not isinstance(it, dict) or not isinstance(it.get(key), dict):
            raise BridgeRefusal("malformed element list")
        out.append({"elementId": it[key]})
    return out


def _require_own(ac: Archicad, port: int, elements: list[dict[str, Any]]) -> None:
    if not elements:
        return
    data = ac.tapir(port, "GetElementUserData", {"elements": elements, "keys": [OWN_KEY]})
    for entry in data.get("elementUserData", []):
        pairs = entry.get("userData") if isinstance(entry, dict) else None
        if not pairs or not any(p.get("key") == OWN_KEY and p.get("value") for p in pairs):
            raise BridgeRefusal("refused: element was not created by Kubatur")
    if len(data.get("elementUserData", [])) != len(elements):
        raise BridgeRefusal("refused: could not verify all elements")


# Tool default layers Kubatur switches while it creates elements Tapir 2.0.0 cannot give a layer.
LAYER_DEFAULT_TYPES = ("Zone", "Stair", "Roof")
# Default layer seen before the bridge switched it to an "MS - " layer, per (port, element type).
_previous_layer: dict[tuple[int, str], str] = {}
_previous_lock = threading.Lock()


def _guard_layer_defaults(ac: Archicad, port: int, p: dict[str, Any]) -> None:
    items = p.get("layersOfElementDefaults") or []
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise BridgeRefusal("refused: exactly one layer default can be set")
    it = items[0]
    guid = (it.get("layerId") or {}).get("guid") if isinstance(it.get("layerId"), dict) else None
    etype = it.get("elementType")
    if etype not in LAYER_DEFAULT_TYPES or not guid:
        raise BridgeRefusal("refused: only the Zone, Stair and Roof default layers can be set")
    layers = ac.tapir(port, "GetAttributesByType", {"attributeType": "Layer"}).get("attributes", [])
    target = next((a for a in layers if (a.get("attributeId") or {}).get("guid") == guid), None)
    if target is None:
        raise BridgeRefusal("refused: unknown layer")
    key = (port, etype)
    with _previous_lock:
        if str(target.get("name", "")).startswith(NAME_PREFIX):
            current = ac.tapir(port, "GetLayerOfElementDefaults", {"elementTypes": [etype]})
            cur = (current.get("layersOfElementDefaults") or [{}])[0]
            cur_guid = (cur.get("layerId") or {}).get("guid")
            if cur_guid and not str(cur.get("layerName", "")).startswith(NAME_PREFIX):
                _previous_layer[key] = cur_guid
        elif _previous_layer.get(key) == guid:
            _previous_layer.pop(key, None)
        else:
            raise BridgeRefusal(f"refused: the {etype} default layer can only be restored to its previous layer")


def _guard_stories(ac: Archicad, port: int, p: dict[str, Any]) -> None:
    info = ac.tapir(port, "GetProjectInfo")
    if not info.get("isUntitled") or info.get("isTeamwork"):
        raise BridgeRefusal("refused: stories are only changed in an untitled test project")
    new = p.get("stories")
    current = ac.tapir(port, "GetStories").get("stories", [])
    if not isinstance(new, list) or len(new) < len(current):
        raise BridgeRefusal("refused: SetStories must not remove stories")


def execute(ac: Archicad, port: int, command: str, parameters: Any) -> Any:
    if port not in ARCHICAD_PORTS:
        raise BridgeRefusal(f"port {port} outside {ARCHICAD_PORTS.start}-{ARCHICAD_PORTS.stop - 1}")
    if command in API_COMMANDS:
        return ac.raw(port, command, parameters or None)
    if command in READ_COMMANDS or command in CREATE_COMMANDS:
        return ac.tapir(port, command, parameters)
    if command not in GUARDED_COMMANDS:
        raise BridgeRefusal(f"command not allowed: {command}")
    p = parameters if isinstance(parameters, dict) else {}
    if command == "DeleteElements":
        _require_own(ac, port, _element_ids(p.get("elements")))
    elif command == "SetDetailsOfElements":
        items = p.get("elementsWithDetails") or []
        for it in items:
            details = it.get("details") if isinstance(it, dict) else None
            if not isinstance(details, dict) or set(details.keys()) - {"layerIndex", "id"}:
                raise BridgeRefusal("refused: only layerIndex and id can be set")
        _require_own(ac, port, _element_ids(items))
    elif command in ("CreateLayers", "CreateZoneCategories"):
        key = "layerDataArray" if command == "CreateLayers" else "zoneCategoryDataArray"
        if p.get("overwriteExisting"):
            raise BridgeRefusal("refused: overwriteExisting")
        for it in p.get(key) or []:
            if not str(it.get("name", "")).startswith(NAME_PREFIX) or "attributeId" in it or "index" in it:
                raise BridgeRefusal(f"refused: names must start with '{NAME_PREFIX}'")
    elif command == "SetLayerOfElementDefaults":
        _guard_layer_defaults(ac, port, p)
    elif command == "SetStories":
        _guard_stories(ac, port, p)
    return ac.tapir(port, command, parameters)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def make_handler(ac: Archicad, token: str, origins: set[str]):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"{NAME}/{VERSION}"

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter console
            if os.environ.get("KUBATUR_BRIDGE_VERBOSE"):
                super().log_message(fmt, *args)

        # -- helpers -------------------------------------------------------
        def _origin_ok(self) -> bool:
            origin = self.headers.get("Origin")
            return origin is None or origin in origins

        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            if origin and origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                # Chrome Private / Local Network Access preflight
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")

        def _send(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            auth = self.headers.get("Authorization", "")
            return secrets.compare_digest(auth, f"Bearer {token}")

        def _error(self, status: int, message: str) -> None:
            self._send(status, {"ok": False, "error": {"message": message}})

        # -- verbs ---------------------------------------------------------
        def do_OPTIONS(self) -> None:  # noqa: N802
            if not self._origin_ok():
                self._error(403, "origin not allowed")
                return
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if not self._origin_ok():
                self._error(403, "origin not allowed")
                return
            if self.path == "/health":
                self._send(200, {"ok": True, "result": {"ok": True, "name": NAME, "version": VERSION, "authorized": self._authorized()}})
                return
            if not self._authorized():
                self._error(401, "pairing token missing or wrong")
                return
            if self.path == "/instances":
                self._send(200, {"ok": True, "result": {"instances": ac.instances()}})
                return
            self._error(404, "not found")

        def do_POST(self) -> None:  # noqa: N802
            if not self._origin_ok():
                self._error(403, "origin not allowed")
                return
            if not self._authorized():
                self._error(401, "pairing token missing or wrong")
                return
            if self.path != "/call":
                self._error(404, "not found")
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length > 50 * 1024 * 1024:
                    self._error(413, "request too large")
                    return
                body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                port = int(body.get("port"))
                command = str(body.get("command"))
                result = execute(ac, port, command, body.get("parameters"))
                self._send(200, {"ok": True, "result": result})
            except BridgeRefusal as e:
                self._error(403, str(e))
            except ArchicadError as e:
                self._error(502, str(e))
            except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                self._error(502, f"Archicad not reachable: {e}")
            except (ValueError, TypeError) as e:
                self._error(400, f"bad request: {e}")

    return Handler


def token_file() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / ".config")
    return base / "kubatur" / "bridge-token"


def load_token(explicit: str | None) -> str:
    if explicit:
        return explicit
    f = token_file()
    if f.exists():
        t = f.read_text(encoding="utf-8").strip()
        if t:
            return t
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    t = "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(t, encoding="utf-8")
    return t


def build_server(port: int, token: str, origins: set[str], archicad: Archicad | None = None) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(archicad or Archicad(), token, origins))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Kubatur ↔ Archicad bridge")
    ap.add_argument("--port", type=int, default=int(os.environ.get("KUBATUR_BRIDGE_PORT", DEFAULT_PORT)))
    ap.add_argument("--origin", action="append", default=[], help="additional allowed web-app origin (repeatable)")
    ap.add_argument("--token", default=os.environ.get("KUBATUR_BRIDGE_TOKEN"), help="fixed pairing token")
    ap.add_argument("--new-token", action="store_true", help="generate a new pairing token")
    args = ap.parse_args(argv)

    if args.new_token and token_file().exists():
        token_file().unlink()
    token = load_token(args.token)
    env_origins = [o.strip() for o in os.environ.get("KUBATUR_ORIGINS", "").split(",") if o.strip()]
    origins = set(DEFAULT_ORIGINS + env_origins + args.origin)
    server = build_server(args.port, token, origins)
    print(f"Kubatur Archicad bridge {VERSION} — http://127.0.0.1:{args.port}")
    print(f"Code d'appairage / Pairing-Code : {token}")
    print("Origines autorisées : " + ", ".join(sorted(origins)))
    print("Ctrl+C pour arrêter.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
