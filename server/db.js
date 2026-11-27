import webpush from 'web-push'
import { openMysql } from './mysql.js'
import { hashPassword } from './passwords.js'
import { addDays, parseTime, zonedDate } from './time.js'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
  \`key\` VARCHAR(191) NOT NULL,
  \`value\` TEXT,
  PRIMARY KEY (\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  operator_id VARCHAR(64),
  active INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(128) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS challenges (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  kind VARCHAR(32) NOT NULL,
  challenge TEXT NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS passkeys (
  id VARCHAR(512) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  public_key TEXT NOT NULL,
  counter INT NOT NULL DEFAULT 0,
  transports TEXT,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_codes (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  used_at VARCHAR(40),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS operators (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(191) NOT NULL,
  experience VARCHAR(32) NOT NULL,
  usual_machine_id VARCHAR(64),
  phone VARCHAR(64),
  email VARCHAR(191),
  notify_job_edges INT,
  active INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS machines (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,
  implement VARCHAR(191),
  track_hours INT,
  track_km INT,
  last_hours DOUBLE,
  last_km DOUBLE,
  active INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(191) NOT NULL,
  contact_role VARCHAR(191),
  phone VARCHAR(64),
  email VARCHAR(191),
  billing VARCHAR(32) NOT NULL,
  active INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sites (
  id VARCHAR(64) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  name VARCHAR(191) NOT NULL,
  address VARCHAR(255),
  push_tag VARCHAR(32) NOT NULL,
  sand_tag VARCHAR(32) NOT NULL,
  haul_tag VARCHAR(32) NOT NULL,
  window_start INT,
  window_end INT,
  bylaw_earliest INT,
  hazards TEXT,
  area_sqft DOUBLE,
  notes TEXT,
  default_sand_yards DOUBLE,
  active INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS days (
  id VARCHAR(64) NOT NULL,
  work_date VARCHAR(10) NOT NULL,
  weather_note TEXT,
  snow_inches DOUBLE,
  trigger_at VARCHAR(40),
  trigger_result VARCHAR(16),
  PRIMARY KEY (id),
  UNIQUE KEY days_work_date (work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS stops (
  id VARCHAR(64) NOT NULL,
  day_id VARCHAR(64) NOT NULL,
  workflow VARCHAR(32) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  from_site_id VARCHAR(64),
  sort_order INT NOT NULL,
  window_start INT NOT NULL,
  window_end INT NOT NULL,
  release_at INT,
  status VARCHAR(32) NOT NULL,
  hold_reason TEXT,
  released_start INT,
  travel_minutes INT,
  load_minutes INT,
  unload_minutes INT,
  overrun_minutes INT NOT NULL DEFAULT 0,
  loads INT,
  driver_note TEXT,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS crew (
  id VARCHAR(64) NOT NULL,
  stop_id VARCHAR(64) NOT NULL,
  operator_id VARCHAR(64) NOT NULL,
  machine_id VARCHAR(64),
  sort_order INT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tickets (
  id VARCHAR(64) NOT NULL,
  day_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  workflow VARCHAR(32) NOT NULL,
  stop_id VARCHAR(64),
  clock_in VARCHAR(40),
  clock_out VARCHAR(40),
  clock_in_2 VARCHAR(40),
  clock_out_2 VARCHAR(40),
  work_done TEXT,
  sand_yards DOUBLE,
  loads INT NOT NULL DEFAULT 0,
  notes TEXT,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS meter_stints (
  id VARCHAR(64) NOT NULL,
  ticket_id VARCHAR(64) NOT NULL,
  machine_id VARCHAR(64) NOT NULL,
  operator_id VARCHAR(64) NOT NULL,
  meter VARCHAR(16) NOT NULL,
  start_reading DOUBLE NOT NULL,
  end_reading DOUBLE,
  started_at VARCHAR(40) NOT NULL,
  ended_at VARCHAR(40),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) NOT NULL,
  day_id VARCHAR(64),
  user_id VARCHAR(64),
  operator_id VARCHAR(64),
  channel VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  body TEXT NOT NULL,
  simulated INT NOT NULL DEFAULT 1,
  delivered INT NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR(512) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  keys_json TEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC`,
]

export function openDatabase() {
  const db = openMysql()
  try {
    for (const statement of SCHEMA) db.exec(statement)
    seed(db)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

function seed(db) {
  const existing = db.prepare('SELECT COUNT(*) AS total FROM users').get()
  if (Number(existing.total) > 0) return
  const keys = webpush.generateVAPIDKeys()
  const settings = {
    units: 'imperial',
    machine_assignment: '0',
    snow_threshold_inches: '2',
    vapid_public: keys.publicKey,
    vapid_private: keys.privateKey,
  }
  const putSetting = db.prepare('INSERT INTO settings (`key`, `value`) VALUES (?, ?)')
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
