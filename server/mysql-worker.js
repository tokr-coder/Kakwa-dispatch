import { parentPort, workerData } from 'node:worker_threads'
import mysql from 'mysql2/promise'

let connection = null
let startupError = null

try {
  connection = await mysql.createConnection({
    host: workerData.host,
    port: workerData.port,
    user: workerData.user,
    password: workerData.password,
    database: workerData.database,
    charset: 'utf8mb4',
    dateStrings: true,
    multipleStatements: false,
    connectTimeout: 15000,
    supportBigNumbers: true,
    bigNumberStrings: false,
  })
} catch (error) {
  startupError = error
}

function plain(value) {
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(plain)
  if (Buffer.isBuffer(value)) return value
  if (value && typeof value === 'object') {
    const copy = {}
    for (const [key, item] of Object.entries(value)) copy[key] = plain(item)
    return copy
  }
  return value
}

parentPort.on('message', async (message) => {
  const flag = new Int32Array(message.sab)
  try {
    if (startupError) {
      const where = `${workerData.host}:${workerData.port}/${workerData.database}`
      throw new Error(`Could not connect to MySQL (${where}). ${startupError.message}`)
    }
    let result = null
    if (message.type === 'exec') {
      await connection.query(message.sql)
    } else if (message.type === 'query') {
      const params = (message.params || []).map((value) => (value === undefined ? null : value))
      const [rows] = await connection.query(message.sql, params)
      if (message.mode === 'get') result = plain(rows[0])
      else if (message.mode === 'all') result = plain(rows)
    } else if (message.type === 'close') {
      await connection.end()
    }
    message.port.postMessage({ ok: true, result })
  } catch (error) {
    message.port.postMessage({ ok: false, message: error.message, code: error.code || '' })
  } finally {
    Atomics.store(flag, 0, 1)
    Atomics.notify(flag, 0)
  }
})
