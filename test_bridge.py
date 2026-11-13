import json
import subprocess
import sys
from datetime import datetime, timezone

payload = {
    "residents": [
        {
            "id": "test-user",
            "locality": "Test Area",
        }
    ],
    "reports": [
        {
            "userId": "test-user",
            "affected": True,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "location": {
                "lat": 12.9716,
                "lon": 77.5946,
            },
            "building_id": "test-building",
        }
    ],
}

# Two nearby groups, each containing 12 independent residents.
payload = {"residents": [], "reports": []}
timestamp = datetime.now(timezone.utc).isoformat()

for group, base_lat in [("a", 12.9716), ("b", 13.0716)]:
    for i in range(12):
        uid = f"test-{group}-{i}"

        payload["residents"].append({
            "id": uid,
            "locality": f"Test Area {group.upper()}",
        })

        payload["reports"].append({
            "userId": uid,
            "affected": True,
            "createdAt": timestamp,
            "location": {
                "lat": base_lat + i * 0.00001,
                "lon": 77.5946,
            },
            "building_id": f"house-{group}-{i}",
        })

result = subprocess.run(
    [sys.executable, "detector_bridge.py"],
    input=json.dumps(payload),
    capture_output=True,
    text=True,
)

print(result.stdout)
if result.returncode != 0:
    print(result.stderr)