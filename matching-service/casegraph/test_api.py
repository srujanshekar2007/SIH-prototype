import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from api import create_app


class FakeMatch:
    model_id = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    def match(self, complaints, threshold):
        return []


class CaseGraphApiTests(unittest.TestCase):
    def setUp(self):
        self.key_patch = patch.dict(os.environ, {"CASEGRAPH_API_KEY": "test-only-secret"})
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)
        self.client = TestClient(create_app(matcher=FakeMatch()))
        self.payload = {"complaints": [
            {"id": "one", "original_text": "A sufficiently detailed first complaint."},
            {"id": "two", "original_text": "A sufficiently detailed second complaint."},
        ], "threshold": -1}

    def test_match_requires_server_to_server_bearer_key(self):
        self.assertEqual(self.client.post("/api/v1/matches", json=self.payload).status_code, 401)
        response = self.client.post("/api/v1/matches", json=self.payload, headers={"Authorization": "Bearer test-only-secret"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model_id"], FakeMatch.model_id)

    def test_match_rejects_invalid_complaint_input_without_echoing_text(self):
        response = self.client.post("/api/v1/matches", json={"complaints": [{"id": "private", "original_text": " "}], "threshold": 0.5}, headers={"Authorization": "Bearer test-only-secret"})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("private", response.text)
