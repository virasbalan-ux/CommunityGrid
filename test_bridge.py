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

result = subprocess.run(
    [sys.executable, "detector_bridge.py"],
    input=json.dumps(payload),
    capture_output=True,
    text=True,
)

print(result.stdout)
if result.returncode != 0:
    print(result.stderr)