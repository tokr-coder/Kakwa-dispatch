# Kakwa Dispatch

Phase 1 is snow dispatch for the day shift: pushing, sanding, and hauling. Those three workflows are siblings. A later delivery workflow can be added beside them. It is not part of pushing, and this build has no delivery orders, delivery board, or Lightspeed connection.

## Run it

Node 20 is enough. The app stores its data in MySQL.

Set the database from the environment:

- `MYSQL_HOST`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `MYSQL_PORT` (optional, default 3306)

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173. The API listens on http://127.0.0.1:8787.

`npm test` does not use the cPanel database. When `MYSQL_HOST` is unset, it starts a throwaway MariaDB or MySQL on this machine, creates a database named `kakwa_test`, and removes it when the tests finish. Install the server once with:

```bash
sudo apt-get install -y mariadb-server
```

If `MYSQL_HOST` is already set, `npm test` creates and drops `kakwa_test` on that server. It leaves `MYSQL_DATABASE` alone.

The first start of an empty database creates the tables and the sample accounts. A later start leaves that data in place.

## cPanel

The host Node version can be 20.20.2.

1. Create a MySQL database and a database user in cPanel.
2. Open the Node.js app and set the startup file to `server/index.js`.
3. Set `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, and `MYSQL_PORT` on that app. On cPanel, `MYSQL_HOST` is usually `localhost`.
4. Run `npm install` and `npm run build`.
5. Restart the app. `npm run build` writes the pages the startup file serves.

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
