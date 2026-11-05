"""Deploys firestore.rules to the Firebase project using a service-account key.

Usage: python -I scripts/deploy_firestore_rules.py path/to/service-account.json
(Equivalent to `firebase deploy --only firestore:rules`; avoids installing firebase-tools.)
"""
import json
import pathlib
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

root = pathlib.Path(__file__).resolve().parent.parent
key_path = sys.argv[1]
project = json.loads(pathlib.Path(key_path).read_text())["project_id"]
cred = service_account.Credentials.from_service_account_file(
    key_path, scopes=["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"]
)
s = AuthorizedSession(cred)
base = f"https://firebaserules.googleapis.com/v1/projects/{project}"
source = (root / "firestore.rules").read_text()

r = s.post(f"{base}/rulesets", json={"source": {"files": [{"name": "firestore.rules", "content": source}]}})
if r.status_code != 200:
    sys.exit(f"Ruleset rejected ({r.status_code}): {r.text}")
ruleset = r.json()["name"]
release = f"projects/{project}/releases/cloud.firestore"
r = s.patch(f"https://firebaserules.googleapis.com/v1/{release}", json={"release": {"name": release, "rulesetName": ruleset}})
if r.status_code != 200:
    sys.exit(f"Release failed ({r.status_code}): {r.text}")
print(f"Deployed {ruleset} to {release}")
