import { spawn } from 'node:child_process'

const server = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' })
const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })

function stop() {
  server.kill()
  web.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
web.on('exit', (code) => {
  server.kill()
  process.exit(code ?? 0)
})
