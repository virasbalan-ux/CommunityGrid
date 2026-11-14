# BijliMitra updated MVP

Run in VS Code:
1. Install Node.js LTS.
2. Open this folder in VS Code terminal.
3. Run `npm install` then `npm start`.
4. Visit http://localhost:3000.

Demo accounts:
- asha / demo123 (resident)
- rahul / demo123 (same apartment block neighbour)
- meera / demo123, dev / demo123 (independent homes)
- admin / admin123 (handler)

Features: planned outage notices sent by admin to residents matching a locality; incident reports; neighbour yes/no response; Yes confirms a wider outage and suppresses home check; No prompts the original reporter to complete home check; if nobody responds for 5 minutes, the original reporter receives a follow-up on next app poll; complaint recording; incident status and restoration tracking; JSON persistence.

Data is stored in data/db.json. Existing JSON data is retained; missing arrays are initialized. To reset, stop server and delete data/db.json, then restart.

Prototype limitations: notifications are in-app and polling-based, not push notifications; five-minute follow-up occurs when dashboard polls. Admin does not automatically contact the electricity provider. JSON storage is for local demonstration, not production. Use a real database, HTTPS, stronger secrets and access controls before deployment.
