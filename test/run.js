import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'

const database = 'kakwa_test'

const started = await testEnv()
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'test/api.test.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: started.env,
})
const code = await new Promise((resolve, reject) => {
  child.on('exit', (status) => resolve(status ?? 1))
  child.on('error', reject)
})
started.stop()
process.exit(code)

async function testEnv() {
  if (process.env.MYSQL_HOST) return useExistingServer()
  return startLocalServer()
}

async function useExistingServer() {
  const missing = ['MYSQL_USER', 'MYSQL_PASSWORD'].filter((name) => process.env[name] == null)
  if (missing.length) throw new Error(`Set ${missing.join(', ')} along with MYSQL_HOST.`)
  const port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306
  const admin = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: false,
  })
  await resetDatabase(admin)
  await admin.end()
  return {
    env: { ...process.env, MYSQL_PORT: String(port), MYSQL_DATABASE: database },
    stop() {},
  }
}

async function startLocalServer() {
  const binary = findServer()
  if (!binary) {
    console.error('npm test needs MySQL or MariaDB.')
    console.error('Install it with: sudo apt-get install -y mariadb-server')
    console.error('Or point the test at a server with MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, and MYSQL_PORT.')
    process.exit(1)
  }
  const dir = mkdtempSync(join(tmpdir(), 'kakwa-mysql-'))
  const socket = join(dir, 'mysql.sock')
  const port = await freePort()
  const password = randomBytes(18).toString('hex')
  const install = spawnSync('mariadb-install-db', [
    '--no-defaults',
    `--datadir=${dir}`,
    '--auth-root-authentication-method=normal',
    '--skip-test-db',
  ], { encoding: 'utf8' })
  if (install.status !== 0) {
    console.error(install.stdout)
    console.error(install.stderr)
    throw new Error('Could not initialize the local MySQL data directory.')
  }
  const config = join(dir, 'my.cnf')
  writeFileSync(config, `[mysqld]
bind-address=127.0.0.1
port=${port}
socket=${socket}
datadir=${dir}
pid-file=${join(dir, 'mysql.pid')}
skip-name-resolve
innodb_use_native_aio=0
`)
  const server = spawn(binary, [`--defaults-file=${config}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', (chunk) => { log += chunk })
  server.stderr.on('data', (chunk) => { log += chunk })
  const stop = () => {
    if (server.exitCode == null && server.signalCode == null) server.kill('SIGTERM')
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // The server may still be releasing the data directory.
    }
  }
  try {
    const root = await waitForRoot(socket, () => log)
    await resetDatabase(root)
    await root.query(`CREATE USER 'kakwa'@'127.0.0.1' IDENTIFIED BY '${password}'`)
    await root.query(`GRANT ALL PRIVILEGES ON ${database}.* TO 'kakwa'@'127.0.0.1'`)
    await root.query('FLUSH PRIVILEGES')
    await root.end()
  } catch (error) {
    console.error(log.slice(-4000))
    stop()
    throw error
  }
  return {
    stop,
    env: {
      ...process.env,
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: String(port),
      MYSQL_USER: 'kakwa',
      MYSQL_PASSWORD: password,
      MYSQL_DATABASE: database,
    },
  }
}

function findServer() {
  for (const path of ['/usr/sbin/mariadbd', '/usr/sbin/mysqld', '/usr/bin/mysqld']) {
    if (existsSync(path)) return path
  }
  const found = spawnSync('command', ['-v', 'mariadbd'], { encoding: 'utf8', shell: true })
  return found.status === 0 ? found.stdout.trim() : ''
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForRoot(socketPath, log) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < 30000) {
    try {
      const conn = await mysql.createConnection({ socketPath, user: 'root', password: '', connectTimeout: 1000 })
      await conn.query('SELECT 1')
      return conn
    } catch (error) {
      last = error.message
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Local MySQL did not start. ${last}\n${log().slice(-2000)}`)
}

async function resetDatabase(conn) {
  await conn.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
}
