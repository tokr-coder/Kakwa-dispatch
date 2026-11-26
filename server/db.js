import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import webpush from 'web-push'
import { hashPassword } from './passwords.js'
import { addDays, parseTime, zonedDate } from './time.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  operator_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  experience TEXT NOT NULL,
  usual_machine_id TEXT,
  phone TEXT,
  email TEXT,
  notify_job_edges INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  implement TEXT,
  track_hours INTEGER,
  track_km INTEGER,
  last_hours REAL,
  last_km REAL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_role TEXT,
  phone TEXT,
  email TEXT,
  billing TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  push_tag TEXT NOT NULL,
  sand_tag TEXT NOT NULL,
  haul_tag TEXT NOT NULL,
  window_start INTEGER,
  window_end INTEGER,
  bylaw_earliest INTEGER,
  hazards TEXT,
  area_sqft REAL,
  notes TEXT,
  default_sand_yards REAL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  work_date TEXT UNIQUE NOT NULL,
  weather_note TEXT,
  snow_inches REAL,
  trigger_at TEXT,
  trigger_result TEXT
);
CREATE TABLE IF NOT EXISTS stops (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL,
  workflow TEXT NOT NULL,
  site_id TEXT NOT NULL,
  from_site_id TEXT,
  sort_order INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  release_at INTEGER,
  status TEXT NOT NULL,
  hold_reason TEXT,
  released_start INTEGER,
  travel_minutes INTEGER,
  load_minutes INTEGER,
  unload_minutes INTEGER,
  overrun_minutes INTEGER NOT NULL DEFAULT 0,
  loads INTEGER,
  driver_note TEXT
);
CREATE TABLE IF NOT EXISTS crew (
  id TEXT PRIMARY KEY,
  stop_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  machine_id TEXT,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  workflow TEXT NOT NULL,
  stop_id TEXT,
  clock_in TEXT,
  clock_out TEXT,
  clock_in_2 TEXT,
  clock_out_2 TEXT,
  work_done TEXT,
  sand_yards REAL,
  loads INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS meter_stints (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  meter TEXT NOT NULL,
  start_reading REAL NOT NULL,
  end_reading REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  day_id TEXT,
  user_id TEXT,
  operator_id TEXT,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 1,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  keys_json TEXT NOT NULL
);
`

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  seed(db)
  return db
}

function seed(db) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get()
  if (existing.count > 0) return
  const keys = webpush.generateVAPIDKeys()
  const settings = {
    units: 'imperial',
    machine_assignment: '0',
    snow_threshold_inches: '2',
    vapid_public: keys.publicKey,
    vapid_private: keys.privateKey,
  }
  const putSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(settings)) putSetting.run(key, value)

  const machines = [
    ['ld-12', 'LD-12', 'loader', '14 ft pusher', 1, 0, 1204.6, null],
    ['ld-07', 'LD-07', 'loader', '12 ft angle plow', 1, 0, 986.2, null],
    ['ld-19', 'LD-19', 'loader', 'Snow blower', 1, 0, 1102.4, null],
    ['st-3', 'ST-3', 'sander', 'Sander', 0, 1, null, 45210],
    ['st-6', 'ST-6', 'sander', 'Sander', 0, 1, null, 39840],
    ['ht-2', 'HT-2', 'haul_truck', 'Haul truck · pup', null, null, null, null],
    ['ht-5', 'HT-5', 'haul_truck', 'Haul truck', null, null, null, null],
  ]
  const insertMachine = db.prepare(`INSERT INTO machines
    (id, code, type, implement, track_hours, track_km, last_hours, last_km, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
  for (const machine of machines) insertMachine.run(...machine)

  const operators = [
    ['op-1', 'Operator 1', 'experienced', 'ld-12', '780-555-0101', 'operator1@kakwa.example'],
    ['op-2', 'Operator 2', 'experienced', 'ld-07', '780-555-0102', 'operator2@kakwa.example'],
    ['op-3', 'Operator 3', 'inexperienced', 'ld-19', '780-555-0103', 'operator3@kakwa.example'],
    ['op-4', 'Operator 4', 'experienced', 'st-3', '780-555-0104', 'operator4@kakwa.example'],
    ['op-5', 'Operator 5', 'inexperienced', 'st-6', '780-555-0105', 'operator5@kakwa.example'],
    ['op-6', 'Operator 6', 'experienced', 'ht-2', '780-555-0106', 'operator6@kakwa.example'],
    ['op-7', 'Operator 7', 'inexperienced', 'ht-5', '780-555-0107', 'operator7@kakwa.example'],
  ]
  const insertOperator = db.prepare(`INSERT INTO operators
    (id, label, experience, usual_machine_id, phone, email, notify_job_edges, active)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 1)`)
  for (const operator of operators) insertOperator.run(...operator)

  const insertUser = db.prepare(`INSERT INTO users
    (id, email, password_hash, role, operator_id, active) VALUES (?, ?, ?, ?, ?, 1)`)
  insertUser.run('user-dispatcher', 'dispatcher@kakwa.example', hashPassword('spruce-day-shift'), 'dispatcher', null)
  insertUser.run('user-backup', 'backup@kakwa.example', hashPassword('spruce-backup-day'), 'dispatcher', null)
  operators.forEach((operator, index) => {
    insertUser.run(
      `user-${operator[0]}`,
      operator[5],
      hashPassword(`operator-${index + 1}-day`),
      'operator',
      operator[0],
    )
  })

  const insertClient = db.prepare(`INSERT INTO clients
    (id, name, contact_role, phone, email, billing, active) VALUES (?, ?, 'Accounts desk', ?, ?, ?, 1)`)
  const clients = [
    ['client-northgate', 'Northgate Retail', '780-555-0201', 'accounts.northgate@kakwa.example', 'flat'],
    ['client-pinnacle', 'Pinnacle Contract', '780-555-0202', 'accounts.pinnacle@kakwa.example', 'hourly'],
    ['client-riverstone', 'Riverstone Housing', '780-555-0203', 'accounts.riverstone@kakwa.example', 'flat'],
    ['client-clinic', 'Clinic Group', '780-555-0204', 'accounts.clinic@kakwa.example', 'flat'],
    ['client-horizon', 'Horizon Schools', '780-555-0205', 'accounts.horizon@kakwa.example', 'flat'],
    ['client-westwind', 'Westwind Stores', '780-555-0206', 'accounts.westwind@kakwa.example', 'flat'],
    ['client-lakeland', 'Lakeland Logistics', '780-555-0207', 'accounts.lakeland@kakwa.example', 'flat'],
  ]
  for (const client of clients) insertClient.run(...client)

  const insertSite = db.prepare(`INSERT INTO sites
    (id, client_id, name, address, push_tag, sand_tag, haul_tag, window_start, window_end, bylaw_earliest, hazards, area_sqft, notes, default_sand_yards, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
  const sites = [
    ['site-northgate', 'client-northgate', 'Northgate Plaza', '10420 99 Ave', 'automatic', 'automatic', 'automatic', '05:00', '07:00', null, '', 180000, 'Large front lot and the cart corral.', 2],
    ['site-pinnacle', 'client-pinnacle', 'Pinnacle Industrial', '8201 116 St', 'automatic', 'automatic', 'automatic', '07:00', '09:30', null, '', 240000, 'Yard gates face 116 St.', 1.5],
    ['site-riverstone', 'client-riverstone', 'Riverstone Apartments', '9805 100 St', 'automatic', 'automatic', 'off', '06:30', '08:30', '06:30', 'Power lines in the back alley', 90000, 'Watch the back alley.', null],
    ['site-creekview', 'client-clinic', 'Creekview Medical', '11203 100 St', 'off', 'on_call', 'off', '08:00', '08:30', null, '', 42000, 'Ambulance bay stays open.', 0.5],
    ['site-horizon', 'client-horizon', 'Horizon School', '7302 97 Ave', 'automatic', 'automatic', 'automatic', '07:00', '09:00', null, '', 160000, 'Bus loop before the front doors.', 1],
    ['site-westwind', 'client-westwind', 'Westwind Retail', '12202 100 St', 'off', 'on_call', 'off', '08:00', '08:30', null, '', 130000, "Don't forget the drive-through.", 3],
    ['site-lakeland', 'client-lakeland', 'Lakeland Warehouse', '15501 97 St', 'automatic', 'off', 'automatic', '05:00', '08:00', null, '', 200000, "Don't forget the shipping dock.", null],
    ['site-cedar', 'client-clinic', 'Cedar Court Clinic', '10112 105 Ave', 'automatic', 'automatic', 'off', '08:00', '10:00', null, 'Power lines along the lane', 38000, 'Keep the patient drop-off clear.', 0.75],
  ]
  for (const site of sites) {
    insertSite.run(
      site[0], site[1], site[2], site[3], site[4], site[5], site[6],
      parseTime(site[7]), parseTime(site[8]), parseTime(site[9]),
      site[10], site[11], site[12], site[13],
    )
  }

  const today = zonedDate()
  const previous = addDays(today, -1)
  db.prepare('INSERT INTO days (id, work_date) VALUES (?, ?)').run('day-previous', previous)
  const insertStop = db.prepare(`INSERT INTO stops
    (id, day_id, workflow, site_id, from_site_id, sort_order, window_start, window_end, release_at, status, travel_minutes, load_minutes, unload_minutes, overrun_minutes)
    VALUES (?, 'day-previous', ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, 0)`)
  insertStop.run('stop-prev-1', 'pushing', 'site-northgate', null, 1, parseTime('05:00'), parseTime('07:00'), parseTime('06:30'), null, null, null)
  insertStop.run('stop-prev-2', 'pushing', 'site-riverstone', null, 2, parseTime('06:30'), parseTime('08:30'), null, null, null, null)
  insertStop.run('stop-prev-3', 'pushing', 'site-pinnacle', null, 3, parseTime('07:00'), parseTime('09:30'), null, null, null, null)
  insertStop.run('stop-prev-4', 'sanding', 'site-northgate', null, 1, parseTime('05:15'), parseTime('05:40'), null, null, null, null)
  insertStop.run('stop-prev-5', 'sanding', 'site-pinnacle', null, 2, parseTime('07:15'), parseTime('07:45'), null, null, null, null)
  insertStop.run('stop-prev-6', 'hauling', 'site-lakeland', 'site-northgate', 1, parseTime('10:00'), parseTime('11:05'), null, 25, 20, 20)
  const insertCrew = db.prepare('INSERT INTO crew (id, stop_id, operator_id, machine_id, sort_order) VALUES (?, ?, ?, NULL, ?)')
  insertCrew.run('crew-prev-1', 'stop-prev-1', 'op-1', 1)
  insertCrew.run('crew-prev-2', 'stop-prev-2', 'op-1', 1)
  insertCrew.run('crew-prev-3', 'stop-prev-3', 'op-2', 1)
  insertCrew.run('crew-prev-4', 'stop-prev-3', 'op-3', 2)
  insertCrew.run('crew-prev-5', 'stop-prev-4', 'op-4', 1)
  insertCrew.run('crew-prev-6', 'stop-prev-5', 'op-4', 1)
  insertCrew.run('crew-prev-7', 'stop-prev-6', 'op-6', 1)
}
