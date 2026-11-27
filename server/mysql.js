import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads'

const NAMES = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']

export function mysqlConfig(env = process.env) {
  const missing = NAMES.filter((name) => env[name] == null)
  if (missing.length) {
    throw new Error(`Set ${missing.join(', ')}. MYSQL_PORT defaults to 3306.`)
  }
  const port = env.MYSQL_PORT == null || env.MYSQL_PORT === '' ? 3306 : Number(env.MYSQL_PORT)
  if (!Number.isInteger(port) || port <= 0) throw new Error('MYSQL_PORT must be a port number.')
  return {
    host: env.MYSQL_HOST,
    port,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
  }
}

export function openMysql(env = process.env) {
  const config = mysqlConfig(env)
  const worker = new Worker(new URL('./mysql-worker.js', import.meta.url), { workerData: config })
  let failed = null
  worker.on('error', (error) => {
    failed = error
  })
  worker.on('exit', (code) => {
    if (code !== 0) failed = new Error(`MySQL connection closed (${code}).`)
  })

  function call(type, fields) {
    if (failed) throw failed
    const { port1, port2 } = new MessageChannel()
    const sab = new SharedArrayBuffer(4)
    const flag = new Int32Array(sab)
    worker.postMessage({ type, ...fields, port: port2, sab }, [port2])
    const status = Atomics.wait(flag, 0, 0, 60000)
    if (status === 'timed-out') throw new Error('MySQL did not answer.')
    const received = receiveMessageOnPort(port1)
    if (!received) throw new Error(failed?.message || 'MySQL returned no result.')
    if (!received.message.ok) {
      const error = new Error(received.message.message)
      error.code = received.message.code
      throw error
    }
    return received.message.result
  }

  return {
    prepare(sql) {
      return {
        get: (...params) => call('query', { sql, params, mode: 'get' }),
        all: (...params) => call('query', { sql, params, mode: 'all' }),
        run: (...params) => call('query', { sql, params, mode: 'run' }),
      }
    },
    exec(sql) {
      call('exec', { sql })
    },
    close() {
      try {
        call('close', {})
      } catch {
        // The process is shutting down. The connection can close on its own.
      }
      worker.terminate()
    },
  }
}
