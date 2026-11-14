# CommunityGrid

Local power-outage reporting prototype with space-time HDBSCAN
clustering and history-based reporter trust.

## Requirements

- Node.js LTS
- Python (tested with Python 3.15.2)
- Git

## Setup on Windows

Open a terminal in the main CommunityGrid folder.

Create the Python environment:

```powershell
py -m venv .venv
```

Install Python dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Install website dependencies:

```powershell
npm.cmd --prefix bijlimitra_mvp_v2 install
```

## Start the website

From the main CommunityGrid folder:

```powershell
npm.cmd --prefix bijlimitra_mvp_v2 start
```

Open http://localhost:3000 and keep the terminal running.
Press Ctrl+C to stop the server.

## Demo accounts

- Residents: asha, rahul, meera, dev — password: demo123
- Handler: admin — password: admin123

Use these accounts only for the local demo.

## Outage analysis

Residents may submit their current location when they are at the
outage location. Reports without coordinates remain saved but
cannot enter geographic clustering.

As admin, open the handler dashboard and click Run outage analysis.
Only reports from active incidents within the last 30 minutes
contribute to clustering. Each user contributes at most one report.

Building identities help distinguish single-building reports from
reports spanning multiple buildings. They do not establish the
electrical cause or whether buildings share a supply.

## Reporter trust

The handler can review individual positive outage reports and record
supporting evidence. Confirmed and false outcomes update reporting
reliability. Unreviewed residents receive neutral trust.

A confirmed home or building outage is still a valid outage report.
An outlier or lack of neighbour confirmation does not establish
a false report.

## Synthetic checks

From the main CommunityGrid folder:

```powershell
.\.venv\Scripts\python.exe outage_detector.py
.\.venv\Scripts\python.exe test_bridge.py
```

These use fictional data and do not modify the website database.

## Limitations

- Experimental evidence scores are not calibrated outage probabilities.
- Handler review is required; no external utility notification is sent.
- Locality false-report history is not implemented.
- Browser location accuracy varies.
- JSON storage and demo authentication are for local prototyping.

Local application data is stored in bijlimitra_mvp_v2/data/db.json.
The data folder, Python environment, and node_modules are excluded
from Git.