"""
Power outage detection: HDBSCAN (WHERE) + trust-weighted dynamic threshold (ENOUGH TO TRUST?)

Pipeline:
  complaints -> rolling window -> dedup per user -> HDBSCAN clusters
  -> trust-weighted sum per cluster -> compare with locality's dynamic minimum
  -> confidence score -> notify electricity dept

Install:  pip install numpy scikit-learn   (scikit-learn >= 1.3 has HDBSCAN built in)
Run:      python outage_detector.py
"""
import math
from dataclasses import dataclass

import numpy as np
from sklearn.cluster import HDBSCAN

# ----------------------------------------------------------------------
# CONFIG (all tunable, mention these as "hyperparameters" when explaining)
# ----------------------------------------------------------------------
WINDOW_MIN = 30            # only complaints from the last 30 minutes count
SPATIAL_SCALE_M = 300       # distance scale: 300 metres
TEMPORAL_SCALE_MIN = 10     # time scale: 10 minutes
P_REPORT = 0.05            # expected fraction of app users who report a real outage
MIN_FLOOR = 3              # one or two people can never trigger an alert
CONF_CUTOFF = 0.80         # notify only if confidence >= this
EARTH_RADIUS_M = 6_371_000
CLUSTER_EPS_M = 0          # 0 = let HDBSCAN decide; raise (e.g. 150) to merge nearby clusters


# ----------------------------------------------------------------------
# DATA MODELS
# ----------------------------------------------------------------------
@dataclass
class Locality:
    name: str
    app_users: int            # U: registered users here (cold start: use connections/households)
    false_report_rate: float  # locality reputation: share of past alerts that were false (0..1)


@dataclass
class Complaint:
    user_id: str
    lat: float
    lon: float
    minutes_ago: float
    locality: str
    building_id: str | None = None


@dataclass
class User:
    confirmed: int = 0        # past reports that matched a real outage
    false: int = 0            # past reports flagged false / isolated
    verified: bool = False    # phone/email verified
    gps_match: bool = False   # GPS matches registered locality


# ----------------------------------------------------------------------
# PART A: TRUST WEIGHTS (Beta prior + cold start)
# ----------------------------------------------------------------------
def trust_score(u: User) -> float:
    """
    Cold start (no history): neutral 0.5 + small bonuses for verifiable signals,
    capped at 0.7 until the user has a few reports.
    With history: mean of a Beta(1,1) prior updated by confirmed/false counts:
        trust = (confirmed + 1) / (confirmed + false + 2)
    The +1/+2 is the prior, so new users sit at 0.5 instead of 0 or 1.
    """
    n = u.confirmed + u.false
    if n < 5:  # not enough history yet -> stay near neutral
        bonus = 0.1 * u.verified + 0.1 * u.gps_match
        beta_mean = (u.confirmed + 1) / (n + 2)
        # blend toward history as it accumulates, but cap new users at 0.7
        return min(0.7, 0.5 + bonus + (beta_mean - 0.5) * (n / 5))
    return (u.confirmed + 1) / (n + 2)


# ----------------------------------------------------------------------
# PART B: PER-LOCALITY DYNAMIC MINIMUM
# ----------------------------------------------------------------------
def dynamic_minimum(loc: Locality) -> float:
    """
    N_min = max(floor, ceil(p * U)) * (1 + false_report_rate)
      - p * U     : bigger area -> more complaints needed (scaled by who can actually report)
      - floor     : tiny areas can't trigger on 1-2 complaints
      - (1 + rate): localities with a history of false alarms face a higher bar
    """
    base = max(MIN_FLOOR, math.ceil(P_REPORT * loc.app_users))
    return base * (1 + loc.false_report_rate)


def confidence(weighted_sum: float, n_min: float) -> float:
    """
    Sigmoid on how far the trust-weighted total is above the minimum.
    Steepness k scales with n_min so the curve behaves the same for small and big localities.
    S == N_min -> 0.5 ; S ~ 1.35 * N_min -> ~0.8 ; S >> N_min -> ~1.0
    """
    k = 4.0 / n_min
    return 1.0 / (1.0 + math.exp(-k * (weighted_sum - n_min)))


# ----------------------------------------------------------------------
# PART C: HDBSCAN (the "where" step)
# ----------------------------------------------------------------------
def cluster_complaints(complaints: list[Complaint]) -> np.ndarray:
    """Group reports using geographic distance and time separation."""
    if len(complaints) < 3:
        return np.full(len(complaints), -1, dtype=int)

    # Convert latitude and longitude from degrees to radians.
    coords = np.radians([[c.lat, c.lon] for c in complaints])
    lat = coords[:, 0]
    lon = coords[:, 1]

    # Calculate the geographic distance between every pair of reports.
    dlat = lat[:, None] - lat[None, :]
    dlon = lon[:, None] - lon[None, :]

    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(lat[:, None])
        * np.cos(lat[None, :])
        * np.sin(dlon / 2) ** 2
    )

    distance_m = (
        2 * EARTH_RADIUS_M
        * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    )

    # Calculate the time difference between every pair of reports.
    ages = np.array([c.minutes_ago for c in complaints])
    time_gap_min = np.abs(ages[:, None] - ages[None, :])

    # A pair is close only when BOTH distance and time are small.
    separation = np.maximum(
        distance_m / SPATIAL_SCALE_M,
        time_gap_min / TEMPORAL_SCALE_MIN,
    )
    np.fill_diagonal(separation, 0.0)

    model = HDBSCAN(
        min_cluster_size=3,
        min_samples=2,
        metric="precomputed",
        copy=True,
    )

    return model.fit_predict(separation)


# ----------------------------------------------------------------------
# MAIN DETECTION PIPELINE
# ----------------------------------------------------------------------
def assess_scope(members):
    building_ids = {
        c.building_id
        for c in members
        if c.building_id
    }
    unknown_count = sum(
        1 for c in members if not c.building_id
    )

    if not building_ids:
        return "unknown — building information needed"

    if len(building_ids) == 1:
        if unknown_count:
            return "uncertain — one known building, other locations unknown"
        return "single building — check internal and utility supply"

    return "multiple buildings — wider outage suspected, review required"
def detect_outages(complaints, users, localities):
    # 1) Rolling window: real outages produce a burst, not a trickle
    recent = [c for c in complaints if c.minutes_ago <= WINDOW_MIN]

    # 2) Dedup: one user spamming counts once (keep their latest complaint)
    latest = {}
    for c in recent:
        if c.user_id not in latest or c.minutes_ago < latest[c.user_id].minutes_ago:
            latest[c.user_id] = c
    recent = list(latest.values())

    # 3) HDBSCAN: find spatial clusters
    labels = cluster_complaints(recent)

    alerts = []
    for label in sorted(set(labels) - {-1}):
        members = [c for c, l in zip(recent, labels) if l == label]

        # Cluster's locality = most common locality among its complaints
        loc_name = max(set(c.locality for c in members), key=[c.locality for c in members].count)
        loc = localities[loc_name]

        # 4) Trust-weighted sum instead of a raw count
        S = sum(trust_score(users[c.user_id]) for c in members)

        # 5) Compare with the locality's dynamic minimum, convert to confidence
        n_min = dynamic_minimum(loc)
        conf = confidence(S, n_min)

        alerts.append({
            "cluster": int(label),
            "locality": loc_name,
            "scope": assess_scope(members),
            "complaints": len(members),
            "weighted_sum": round(S, 2),
            "n_min": round(n_min, 2),
            "confidence": round(conf, 3),
            "notify": conf >= CONF_CUTOFF,
            "center": (round(np.mean([c.lat for c in members]), 5),
                       round(np.mean([c.lon for c in members]), 5)),
        })
    return alerts, int(np.sum(labels == -1))


# ----------------------------------------------------------------------
# DEMO WITH SYNTHETIC DATA (clearly fake: say "simulated data" when presenting)
# ----------------------------------------------------------------------
def make_demo_data(seed=42):
    rng = np.random.default_rng(seed)

    localities = {
        "Koramangala":   Locality("Koramangala", app_users=400, false_report_rate=0.05),
        "Small Lane":    Locality("Small Lane",  app_users=30,  false_report_rate=0.0),
        "Troll Colony":  Locality("Troll Colony", app_users=300, false_report_rate=0.60),
    }
    centers = {
        "Koramangala":  (12.9352, 77.6245),
        "Small Lane":   (12.9716, 77.5946),
        "Troll Colony": (13.0358, 77.5970),
    }

    users, complaints = {}, []

    def add(prefix, loc, n, spread_m, trust_profile, minutes_range):
        lat0, lon0 = centers[loc]
        for i in range(n):
            uid = f"{prefix}{i}"
            users[uid] = trust_profile()
            dlat = rng.normal(0, spread_m) / 111_000
            dlon = rng.normal(0, spread_m) / 111_000
            complaints.append(Complaint(uid, lat0 + dlat, lon0 + dlon,
                                        rng.uniform(*minutes_range), loc))

    good = lambda: User(confirmed=int(rng.integers(5, 15)), false=int(rng.integers(0, 2)),
                        verified=True, gps_match=True)
    new = lambda: User(verified=bool(rng.integers(0, 2)), gps_match=True)
    bad = lambda: User(confirmed=1, false=int(rng.integers(4, 8)))

    # Real outage: dense burst of mostly trusted users in a big locality
    add("K", "Koramangala", 40, 200, good, (0, 20))
    # Small locality with only 8 complaints: enough because its minimum is just 3
    add("S", "Small Lane", 8, 40, new, (0, 15))
    # Troll Colony: lots of complaints from low-trust users and a high-false-rate locality
    add("T", "Troll Colony", 12, 150, bad, (0, 20))
    # Scattered noise across the city (isolated complaints)
    for i in range(10):
        uid = f"N{i}"
        users[uid] = new()
        complaints.append(Complaint(uid, 12.85 + rng.uniform(0, 0.25), 77.5 + rng.uniform(0, 0.2),
                                    rng.uniform(0, 25), "Koramangala"))
    # Old complaints outside the window (should be ignored)
    for i in range(8):
        uid = f"O{i}"
        users[uid] = good()
        complaints.append(Complaint(uid, *centers["Koramangala"], rng.uniform(60, 600), "Koramangala"))

    return complaints, users, localities


if __name__ == "__main__":
    complaints, users, localities = make_demo_data()
    alerts, noise = detect_outages(complaints, users, localities)

    print(f"Total complaints: {len(complaints)} | ignored as isolated noise: {noise}\n")
    for a in alerts:
        print(f"\nScope: {a['scope']}")
        status = (
           "REVIEW REQUIRED (check home/building/wider outage)"
            if a["notify"]
            else "hold (not enough evidence)"
        )
        print(f"[Cluster {a['cluster']}] {a['locality']}: {a['complaints']} complaints, "
              f"trust-weighted sum {a['weighted_sum']} vs minimum {a['n_min']} "
              f"-> confidence {a['confidence']} -> {status}")
# Scope checks using simulated reports.
same_building = [
    Complaint("test1", 12.9716, 77.5946, 1, "Test Area", "building-a"),
    Complaint("test2", 12.9716, 77.5946, 2, "Test Area", "building-a"),
]

different_buildings = [
    same_building[0],
    Complaint("test3", 12.9718, 77.5948, 2, "Test Area", "building-b"),
]

print("\nScope checks:")
print("Same building:", assess_scope(same_building))
print("Different buildings:", assess_scope(different_buildings))
# Same locations, but reports arrive in two separate bursts.
test_reports = []

for prefix, age in [("recent", 1), ("earlier", 25)]:
    for i in range(5):
        test_reports.append(
            Complaint(
                user_id=f"{prefix}_{i}",
                lat=12.9716 + i * 0.00001,
                lon=77.5946,
                minutes_ago=age + i * 0.1,
                locality="Test Area",
                building_id=f"building-{i}",
            )
        )

test_labels = cluster_complaints(test_reports)

print("\nTime separation check:")
print("Recent burst: ", test_labels[:5])
print("Earlier burst:", test_labels[5:])