import { randomBytes, randomUUID } from 'node:crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { HttpError } from './errors.js'
import { checkPassword, hashPassword, randomCode } from './passwords.js'
import { nowIso } from './time.js'

const rpID = () => process.env.KAKWA_RP_ID || 'localhost'
const origin = () => process.env.KAKWA_ORIGIN || 'http://127.0.0.1:5173'

export function publicUser(db, row) {
  const operator = row.operator_id ? db.prepare('SELECT * FROM operators WHERE id = ?').get(row.operator_id) : null
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    operatorId: row.operator_id || '',
    operatorLabel: operator?.label || (row.role === 'dispatcher' ? 'Dispatcher' : ''),
    notifyJobEdges: operator ? (operator.notify_job_edges == null ? null : operator.notify_job_edges === 1) : null,
  }
}

export function sessionUser(db, token) {
  if (!token) return null
  const row = db.prepare(`SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ? AND users.active = 1`).get(token, nowIso())
  return row ? publicUser(db, row) : null
}

export function loginPassword(db, email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim().toLowerCase())
  if (!user || !checkPassword(password || '', user.password_hash)) throw new HttpError(401, 'Email or password is wrong.')
  return openSession(db, user)
}

export function openSession(db, user) {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 30 * 864e5).toISOString()
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires)
  return { token, user: publicUser(db, user) }
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function setPassword(db, userId, password) {
  if (!password || String(password).length < 10) throw new HttpError(400, 'Use at least 10 characters.')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId)
}

export function requestRecovery(db, email) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim().toLowerCase())
  if (!user) throw new HttpError(400, 'No account uses that email.')
  const code = randomCode()
  db.prepare('INSERT INTO recovery_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(), user.id, hashPassword(code), new Date(Date.now() + 15 * 60e5).toISOString(),
  )
  const body = `Recovery code for ${user.email}: ${code}. This email was not sent.`
  db.prepare(`INSERT INTO messages
    (id, day_id, user_id, operator_id, channel, kind, body, simulated, delivered, created_at)
    VALUES (?, NULL, ?, ?, 'email', 'recovery', ?, 1, 0, ?)`).run(randomUUID(), user.id, user.operator_id, body, nowIso())
  return {
    simulated: true,
    delivered: false,
    code,
    body,
    notice: 'Email is not connected. This code was not sent. Use it here to finish signing in.',
  }
}

export function verifyRecovery(db, email, code) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim().toLowerCase())
  if (!user) throw new HttpError(400, 'No account uses that email.')
  const rows = db.prepare(`SELECT * FROM recovery_codes WHERE user_id = ? AND used_at IS NULL AND expires_at > ?`).all(user.id, nowIso())
  const match = rows.find((row) => checkPassword(String(code || ''), row.code_hash))
  if (!match) throw new HttpError(400, 'That code is wrong or expired.')
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(nowIso(), match.id)
  return openSession(db, user)
}

function saveChallenge(db, userId, kind, challenge) {
  db.prepare('DELETE FROM challenges WHERE kind = ? AND (user_id = ? OR user_id IS NULL)').run(kind, userId)
  db.prepare('INSERT INTO challenges (id, user_id, kind, challenge, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), userId, kind, challenge, new Date(Date.now() + 5 * 60e5).toISOString(),
  )
}

function takeChallenge(db, userId, kind) {
  const row = db.prepare(`SELECT * FROM challenges WHERE kind = ? AND user_id <=> ? AND expires_at > ?
    ORDER BY expires_at DESC LIMIT 1`).get(kind, userId, nowIso())
  if (!row) throw new HttpError(400, 'That sign-in step expired. Try again.')
  db.prepare('DELETE FROM challenges WHERE id = ?').run(row.id)
  return row.challenge
}

export async function registrationOptions(db, user) {
  const existing = db.prepare('SELECT * FROM passkeys WHERE user_id = ?').all(user.id)
  const options = await generateRegistrationOptions({
    rpName: 'Kakwa Dispatch',
    rpID: rpID(),
    userName: user.email,
    userDisplayName: user.operatorLabel || 'Dispatcher',
    userID: Buffer.from(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.id,
      transports: JSON.parse(row.transports || '[]'),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  saveChallenge(db, user.id, 'register', options.challenge)
  return options
}

export async function registrationVerify(db, user, response) {
  const expectedChallenge = takeChallenge(db, user.id, 'register')
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin(),
      expectedRPID: rpID(),
    })
  } catch (error) {
    throw new HttpError(400, 'The passkey could not be saved.')
  }
  if (!verification.verified) throw new HttpError(400, 'The passkey could not be saved.')
  const credential = verification.registrationInfo.credential
  db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)').run(
    credential.id,
    user.id,
    Buffer.from(credential.publicKey).toString('base64'),
    credential.counter || 0,
    JSON.stringify(credential.transports || []),
  )
  return { saved: true }
}

export async function loginOptions(db) {
  const options = await generateAuthenticationOptions({ rpID: rpID(), userVerification: 'preferred' })
  saveChallenge(db, null, 'login', options.challenge)
  return options
}

export async function loginVerify(db, response) {
  const expectedChallenge = takeChallenge(db, null, 'login')
  const passkey = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response?.id)
  if (!passkey) throw new HttpError(401, 'That passkey is not on an account.')
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin(),
      expectedRPID: rpID(),
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64')),
        counter: passkey.counter,
      },
    })
  } catch (error) {
    throw new HttpError(401, 'The passkey was not accepted.')
  }
  if (!verification.verified) throw new HttpError(401, 'The passkey was not accepted.')
  db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(verification.authenticationInfo.newCounter, passkey.id)
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(passkey.user_id)
  if (!user) throw new HttpError(401, 'That account is not active.')
  return openSession(db, user)
}

export function sessionCookie(token) {
  return `kakwa_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
}

export function clearCookie() {
  return 'kakwa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
}
