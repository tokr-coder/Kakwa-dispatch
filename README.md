# Kakwa Dispatch

Phase 1 is snow dispatch for the day shift: pushing, sanding, and hauling. Those three workflows are siblings. A later delivery workflow can be added beside them. It is not part of pushing, and this build has no delivery orders, delivery board, or Lightspeed connection.

## Run it

Node 22 or newer.

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173. The API listens on http://127.0.0.1:8787. The database is `data/kakwa.sqlite`.

## Sample accounts

| Who | Email | Password |
| --- | --- | --- |
| Dispatcher | dispatcher@kakwa.example | spruce-day-shift |
| Backup dispatcher | backup@kakwa.example | spruce-backup-day |
| Operator 1–7 | operator1@kakwa.example … operator7@kakwa.example | operator-1-day … operator-7-day |

Passkeys work on this machine as well as passwords. A lost password uses a one-time recovery code.

## What is simulated

Texts, pushes, and recovery email are not delivered. The app shows the text that would be sent, stores a push subscription, and shows the recovery code on screen with a notice that email is not connected. Nothing in this build calls a phone, a push service, or an email server.

## Left open

- Whether a job starting or ending notifies the operator or updates quietly. The control is on the operator screen and starts unset. The go call is separate and always notifies.
- Whether haul trucks record hours, kilometres, or both. Those toggles start unset. Loaders record hours. The sander records kilometres.
- Evening shift, invoicing, and drag-and-drop planning are not in this build. Two manual CSV exports are: one for the dispatcher, and one per client that omits meters, engine hours, kilometres, operators, and machines.
