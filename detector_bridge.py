import json
import sys
from datetime import datetime, timezone

from outage_detector import (
    Complaint,
    User,
    Locality,
    detect_outages,
)

def convert_report(report, resident, now):
    location = report.get("location")

    # Reports without coordinates cannot enter geographic clustering.
    if not isinstance(location, dict):
        return None

    lat = location.get("lat")
    lon = location.get("lon")

    if (
        type(lat) not in (int, float)
        or type(lon) not in (int, float)
        or not -90 <= lat <= 90
        or not -180 <= lon <= 180
    ):
        return None

    try:
        created_at = datetime.fromisoformat(
            report["createdAt"].replace("Z", "+00:00")
        )

        if created_at.tzinfo is None:
            return None

        minutes_ago = (now - created_at).total_seconds() / 60
    except (KeyError, TypeError, ValueError):
        return None

    if minutes_ago < 0:
        return None

    return Complaint(
        user_id=resident["id"],
        lat=lat,
        lon=lon,
        minutes_ago=minutes_ago,
        locality=resident["locality"],
        building_id=report.get("building_id"),
    )

def main():
    payload = json.load(sys.stdin)
    now = datetime.now(timezone.utc)

    residents = {
        resident["id"]: resident
        for resident in payload.get("residents", [])
    }

    complaints = []
    skipped = 0

    for report in payload.get("reports", []):
        resident = residents.get(report.get("userId"))

        # Only positive outage reports from known residents count.
        if resident is None or report.get("affected") is not True:
            skipped += 1
            continue

        complaint = convert_report(report, resident, now)

        if complaint is None:
            skipped += 1
            continue

        complaints.append(complaint)

    # Only handler-reviewed outcomes contribute to reporting history.
    users = {}

    for complaint in complaints:
        resident = residents[complaint.user_id]
        history = resident.get("history", {})

        users[complaint.user_id] = User(
            confirmed=history.get("confirmed", 0),
            false=history.get("false", 0),
        )

    # Count registered residents in each locality.
    locality_counts = {}
    for resident in residents.values():
        name = resident.get("locality")
        if name:
            locality_counts[name] = locality_counts.get(name, 0) + 1

    localities = {
        name: Locality(
            name=name,
            app_users=count,
            false_report_rate=0.0,
        )
        for name, count in locality_counts.items()
    }

    alerts, noise_count = detect_outages(
        complaints, users, localities
    )

    # Use review/evidence wording rather than claiming a grid fault.
    for alert in alerts:
        alert["review_required"] = alert.pop("notify")
        alert["evidence_score"] = alert.pop("confidence")

    print(json.dumps({
        "ok": True,
        "converted_reports": len(complaints),
        "skipped_reports": skipped,
        "noise_reports": noise_count,
        "trust_mode": "handler-reviewed history; neutral for residents without reviews",
        "locality_history_available": False,
        "alerts": alerts,
    }))
    
if __name__ == "__main__":
    main()