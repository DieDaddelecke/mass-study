"""Bridge tests against mock_archicad.  Run:  python -m unittest discover tools/archicad-bridge"""

from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import bridge  # noqa: E402
from mock_archicad import MockArchicad, serve  # noqa: E402

MOCK_PORT = 19741
TOKEN = "TEST-TOKN"
ORIGIN = "http://localhost:5173"


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mock = MockArchicad()
        cls.mock_server = serve(cls.mock, MOCK_PORT)
        threading.Thread(target=cls.mock_server.serve_forever, daemon=True).start()
        cls.server = bridge.build_server(0, TOKEN, {ORIGIN})
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.mock_server.shutdown()

    def setUp(self) -> None:
        self.mock.elements.clear()
        self.mock.user_data.clear()
        self.mock.refuse_zones = False

    # -- helpers -----------------------------------------------------------
    def req(self, path, body=None, token=TOKEN, origin=ORIGIN, method=None):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if origin:
            headers["Origin"] = origin
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        r = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(r, timeout=10) as res:
                raw = res.read()
                return res.status, dict(res.headers), json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), json.loads(e.read() or b"null")

    def call(self, command, parameters=None, **kw):
        return self.req("/call", {"port": MOCK_PORT, "command": command, "parameters": parameters or {}}, **kw)

    # -- tests -------------------------------------------------------------
    def test_health_without_token(self):
        status, headers, body = self.req("/health", token=None)
        self.assertEqual(status, 200)
        self.assertFalse(body["result"]["authorized"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)

    def test_preflight_has_private_network_header(self):
        status, headers, _ = self.req("/call", token=None, method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])

    def test_foreign_origin_refused(self):
        status, headers, _ = self.req("/health", origin="https://evil.example")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_token_required(self):
        self.assertEqual(self.call("GetStories", token="WRONG")[0], 401)
        self.assertEqual(self.req("/instances", token=None)[0], 401)

    def test_instances_lists_mock(self):
        status, _, body = self.req("/instances")
        self.assertEqual(status, 200)
        inst = [i for i in body["result"]["instances"] if i["port"] == MOCK_PORT]
        self.assertEqual(len(inst), 1)
        self.assertEqual(inst[0]["tapirVersion"], "2.0.0")
        self.assertEqual(inst[0]["product"]["version"], 28)

    def test_read_command(self):
        status, _, body = self.call("GetStories")
        self.assertEqual(status, 200)
        self.assertEqual([s["name"] for s in body["result"]["stories"]], ["R-1", "RDC", "R+1", "R+2"])

    def test_disallowed_commands(self):
        for cmd in ("SetStories", "DeleteSelectedElements", "IFCFileOperation", "API.GetAllElements"):
            self.assertEqual(self.call(cmd)[0], 403, cmd)

    def test_port_outside_range_refused(self):
        status, _, _ = self.req("/call", {"port": 8080, "command": "GetStories"})
        self.assertEqual(status, 403)

    def test_delete_only_own_elements(self):
        foreign = self.mock.add_foreign("Zone")
        status, _, body = self.call("DeleteElements", {"elements": [{"elementId": {"guid": foreign}}]})
        self.assertEqual(status, 403, body)
        self.assertIn(foreign, self.mock.elements)
        # tag it like Kubatur does, then deleting works
        self.mock.user_data[foreign] = {"kubatur.projectId": "p1"}
        status, _, body = self.call("DeleteElements", {"elements": [{"elementId": {"guid": foreign}}]})
        self.assertEqual(status, 200, body)
        self.assertNotIn(foreign, self.mock.elements)

    def test_set_details_guarded(self):
        g = self.mock.add_foreign("Zone")
        item = {"elementId": {"guid": g}, "details": {"layerIndex": 3}}
        self.assertEqual(self.call("SetDetailsOfElements", {"elementsWithDetails": [item]})[0], 403)
        self.mock.user_data[g] = {"kubatur.projectId": "p1"}
        self.assertEqual(self.call("SetDetailsOfElements", {"elementsWithDetails": [item]})[0], 200)
        item["details"] = {"floorIndex": 2}
        self.assertEqual(self.call("SetDetailsOfElements", {"elementsWithDetails": [item]})[0], 403)

    def test_attribute_names_need_prefix(self):
        self.assertEqual(self.call("CreateLayers", {"layerDataArray": [{"name": "Murs"}]})[0], 403)
        self.assertEqual(
            self.call("CreateLayers", {"layerDataArray": [{"name": "MS - X"}], "overwriteExisting": True})[0], 403
        )
        self.assertEqual(self.call("CreateLayers", {"layerDataArray": [{"name": "MS - Massenstudie"}]})[0], 200)

    def test_create_zone_and_tag(self):
        zone = {
            "floorIndex": 0,
            "name": "Logement",
            "numberStr": "MS-A-RDC",
            "geometry": {"polygonCoordinates": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 8}]},
        }
        status, _, body = self.call("CreateZones", {"zonesData": [zone]})
        self.assertEqual(status, 200)
        g = body["result"]["elements"][0]["elementId"]["guid"]
        self.call("SetElementUserData", {"elementUserData": [{"elementId": {"guid": g}, "userData": [{"key": "kubatur.projectId", "value": "p1"}]}]})
        self.assertEqual(self.mock.user_data[g]["kubatur.projectId"], "p1")

    def test_refused_zone_reported_per_item(self):
        self.mock.refuse_zones = True
        zone = {"floorIndex": 0, "name": "L", "numberStr": "1", "geometry": {"polygonCoordinates": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}]}}
        status, _, body = self.call("CreateZones", {"zonesData": [zone]})
        self.assertEqual(status, 200)
        self.assertIn("Failed to create new Zone", body["result"]["elements"][0]["error"]["message"])

    def test_archicad_unreachable(self):
        status, _, body = self.req("/call", {"port": 19744, "command": "GetStories"})
        self.assertEqual(status, 502)
        self.assertIn("not reachable", body["error"]["message"])


if __name__ == "__main__":
    unittest.main()
