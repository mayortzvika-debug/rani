// em-auth.mjs — server-side authentication, roles, audit and shared shelter data
// for the emergency dashboard. Passwords: scrypt. Sessions: random token in an
// HttpOnly SameSite=Strict cookie, held in server memory (idle + absolute expiry).
import { scrypt, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const scryptAsync = promisify(scrypt)

const ROLES = ['admin', 'commander', 'info_officer', 'dispatcher', 'viewer']
// 'write' roles per module (mirrors TAB_PERMISSIONS in public/emergency/auth.js)
const SHELTER_WRITERS = new Set(['admin', 'commander', 'info_officer'])

// Shared data collections (synced by public/emergency/em_sync.js). `read: null` = every logged-in role.
// Permissions mirror TAB_PERMISSIONS in public/emergency/auth.js.
const FIELD_STAFF = new Set(['admin', 'commander', 'info_officer'])
const COLLECTIONS = {
  shelters:      { read: null,        write: FIELD_STAFF, redact: true },
  activities:    { read: null,        write: FIELD_STAFF },
  residents:     { read: FIELD_STAFF, write: FIELD_STAFF },
  infra:         { read: null,        write: FIELD_STAFF },
  familyCenters: { read: null,        write: FIELD_STAFF },
  statusCards:   { read: null,        write: FIELD_STAFF },
  // info_officer also writes: shelter status updates are logged into the city event journal
  entries:       { read: null,        write: new Set(['admin', 'commander', 'dispatcher', 'info_officer']) },
  sitrep:        { read: null,        write: new Set(['admin', 'commander']) },
}
const SYNC_MAX_BODY = 40 * 1024 * 1024

const IDLE_MS = 30 * 60 * 1000
const ABSOLUTE_MS = 12 * 60 * 60 * 1000
const MAX_FAILS = 5
const LOCKOUT_MS = 30 * 1000
const MAX_BODY = 5 * 1024 * 1024
const MIN_PASSWORD = 8

export function createEmApi({ storageDir, json, text, readBody }) {
  const usersFile = join(storageDir, 'em_users.json')
  const syncFile = join(storageDir, 'em_sync.json')
  const auditFile = join(storageDir, 'em_audit.jsonl')
  const sessions = new Map() // token -> { userId, createdAt, lastSeen }
  const fails = new Map()    // "ip|username" -> { count, lockedUntil }

  // ── storage helpers ───────────────────────────────────────────────────────
  const writeAtomic = (file, data) => {
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, file)
  }
  const readUsers = () => { try { return JSON.parse(readFileSync(usersFile, 'utf8')) } catch { return [] } }
  const writeUsers = (users) => writeAtomic(usersFile, users)

  function audit(actor, action, target, details) {
    try {
      appendFileSync(auditFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        username: actor?.username || 'system',
        role: actor?.role || '-',
        action: String(action).slice(0, 60),
        target: String(target ?? '').slice(0, 200),
        details: String(details ?? '').slice(0, 500),
      }) + '\n')
    } catch { /* audit must never break the request */ }
  }

  // ── passwords ─────────────────────────────────────────────────────────────
  async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const key = await scryptAsync(password, salt, 64)
    return { salt, hash: key.toString('hex') }
  }

  async function verifyPassword(password, user) {
    const { hash } = await hashPassword(password, user.salt)
    const a = Buffer.from(hash, 'hex'), b = Buffer.from(user.hash, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const publicUser = (u) => ({
    id: u.id, username: u.username, displayName: u.displayName, role: u.role,
    locked: !!u.locked, mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt, lastLogin: u.lastLogin || null,
  })

  // First start: create an admin with a one-time password (env or random), printed once.
  async function createAdmin(password) {
    const { salt, hash } = await hashPassword(password)
    return {
      id: randomUUID(), username: 'admin', displayName: 'מנהל מערכת', role: 'admin',
      salt, hash, mustChangePassword: true, locked: false,
      createdAt: new Date().toISOString(), lastLogin: null,
    }
  }

  async function init() {
    if (readUsers().length) return
    const pw = process.env.EM_ADMIN_PASSWORD || randomBytes(9).toString('base64url')
    writeUsers([await createAdmin(pw)])
    console.log('[auth] Created user "admin". ' + (process.env.EM_ADMIN_PASSWORD
      ? 'Password taken from EM_ADMIN_PASSWORD (must be changed at first login).'
      : `One-time password: ${pw}  (must be changed at first login)`))
  }

  // CLI recovery: node server.mjs --reset-admin  (uses EM_ADMIN_PASSWORD or a random one)
  async function resetAdmin() {
    const pw = process.env.EM_ADMIN_PASSWORD || randomBytes(9).toString('base64url')
    const users = readUsers()
    const fresh = await createAdmin(pw)
    const idx = users.findIndex(u => u.username === 'admin')
    if (idx >= 0) users[idx] = { ...users[idx], salt: fresh.salt, hash: fresh.hash, role: 'admin', locked: false, mustChangePassword: true }
    else users.push(fresh)
    writeUsers(users)
    audit(null, 'RESET_ADMIN_CLI', 'admin', '')
    console.log(`[auth] "admin" password reset. One-time password: ${pw}`)
  }

  // ── sessions ──────────────────────────────────────────────────────────────
  const parseCookies = (header = '') => Object.fromEntries(
    header.split(';').map(c => c.trim()).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)] }))

  function sessionFor(request) {
    const token = parseCookies(request.headers.cookie).em_sid
    const s = token && sessions.get(token)
    if (!s) return null
    const now = Date.now()
    if (now - s.lastSeen > IDLE_MS || now - s.createdAt > ABSOLUTE_MS) { sessions.delete(token); return null }
    const user = readUsers().find(u => u.id === s.userId)
    if (!user || user.locked) { sessions.delete(token); return null }
    s.lastSeen = now
    return { token, user }
  }

  const isSecure = (request) => request.headers['x-forwarded-proto'] === 'https' || !!request.socket.encrypted
  const cookie = (request, token, maxAgeSec) =>
    `em_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${isSecure(request) ? '; Secure' : ''}`

  function killSessions(userId, exceptToken) {
    for (const [t, s] of sessions) if (s.userId === userId && t !== exceptToken) sessions.delete(t)
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const clientIp = (request) => String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim()

  async function body(request, max = MAX_BODY) {
    try { return JSON.parse(String(await readBody(request, max)) || '{}') }
    catch (e) { throw Object.assign(new Error(e.message), { status: e.message === 'Body too large' ? 413 : 400 }) }
  }

  const adminCount = (users) => users.filter(u => u.role === 'admin' && !u.locked).length

  let syncCache = null // shared data is large and read on every poll: load from disk once
  const readSync = () => {
    if (syncCache) return syncCache
    try {
      const st = JSON.parse(readFileSync(syncFile, 'utf8'))
      if (st && typeof st.rev === 'number' && st.c) return (syncCache = st)
    } catch { /* first start or unreadable file */ }
    return (syncCache = { rev: 0, c: {} })
  }

  // read-only roles never receive wifi passwords or occupant phone numbers
  function redactShelter(s) {
    const out = { ...s }
    if (out.wifi?.password) out.wifi = { ...out.wifi, password: '' }
    if (Array.isArray(out.occupants)) out.occupants = out.occupants.map(o => ({ ...o, phone: '' }))
    return out
  }

  // ── router: returns true when the request was handled ─────────────────────
  async function handle(request, response, pathname) {
    if (!pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/em/')) return false
    const method = request.method

    try {
      // CSRF defence in depth (cookie is already SameSite=Strict): state changes need a custom header
      if (method !== 'GET' && request.headers['x-requested-with'] !== 'em') { text(response, 403, 'Missing x-requested-with'); return true }

      // ---- login (no session needed) ----
      if (method === 'POST' && pathname === '/api/auth/login') {
        const { username = '', password = '' } = await body(request)
        const uname = String(username).trim().toLowerCase()
        const key = `${clientIp(request)}|${uname}`
        const f = fails.get(key) || { count: 0, lockedUntil: 0 }
        if (f.lockedUntil > Date.now()) {
          text(response, 429, `נעול זמנית. נסה שוב בעוד ${Math.ceil((f.lockedUntil - Date.now()) / 1000)} שניות`); return true
        }
        const users = readUsers()
        const user = users.find(u => u.username.toLowerCase() === uname)
        // always run a hash so response time doesn't reveal whether the user exists
        const ok = user ? await verifyPassword(String(password), user) : (await hashPassword(String(password), 'x'.repeat(32)), false)
        if (!user || !ok || user.locked) {
          f.count++
          if (f.count >= MAX_FAILS) { f.lockedUntil = Date.now() + LOCKOUT_MS; f.count = 0 }
          fails.set(key, f)
          audit(null, 'LOGIN_FAILED', uname, clientIp(request))
          text(response, 401, 'שם משתמש או סיסמה שגויים'); return true
        }
        fails.delete(key)
        user.lastLogin = new Date().toISOString()
        writeUsers(users)
        const token = randomBytes(32).toString('base64url')
        sessions.set(token, { userId: user.id, createdAt: Date.now(), lastSeen: Date.now() })
        audit(user, 'LOGIN', 'system', 'כניסה מוצלחת')
        response.setHeader('Set-Cookie', cookie(request, token, ABSOLUTE_MS / 1000))
        json(response, 200, { user: publicUser(user) }); return true
      }

      // ---- everything below needs a session ----
      const sess = sessionFor(request)
      if (!sess) { text(response, 401, 'Not authenticated'); return true }
      const { user, token } = sess
      const isAdmin = user.role === 'admin'
      const canWriteShelters = SHELTER_WRITERS.has(user.role)

      if (method === 'GET' && pathname === '/api/auth/me') { json(response, 200, { user: publicUser(user) }); return true }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        sessions.delete(token)
        audit(user, 'LOGOUT', 'system', '')
        response.setHeader('Set-Cookie', cookie(request, '', 0))
        json(response, 200, { ok: true }); return true
      }

      if (method === 'POST' && pathname === '/api/auth/change-password') {
        const { current = '', next = '' } = await body(request)
        if (String(next).length < MIN_PASSWORD) { text(response, 400, `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD} תווים`); return true }
        if (!(await verifyPassword(String(current), user))) { text(response, 403, 'הסיסמה הנוכחית שגויה'); return true }
        if (current === next) { text(response, 400, 'הסיסמה החדשה זהה לנוכחית'); return true }
        const users = readUsers()
        const u = users.find(x => x.id === user.id)
        Object.assign(u, await hashPassword(String(next)), { mustChangePassword: false })
        writeUsers(users)
        killSessions(user.id, token)
        audit(user, 'CHANGE_PASSWORD', user.username, '')
        json(response, 200, { user: publicUser(u) }); return true
      }

      // A user who must change the password can do nothing else yet
      if (user.mustChangePassword) { text(response, 403, 'Password change required'); return true }

      // ---- audit (any user may append their own events; admin reads) ----
      if (method === 'POST' && pathname === '/api/em/audit') {
        const b = await body(request)
        audit(user, b.action, b.target, b.details)
        json(response, 200, { ok: true }); return true
      }
      if (method === 'GET' && pathname === '/api/auth/audit') {
        if (!isAdmin) { text(response, 403, 'Forbidden'); return true }
        let lines = []
        if (existsSync(auditFile)) {
          const raw = readFileSync(auditFile, 'utf8')
          lines = raw.split('\n').filter(Boolean).slice(-1000)
        }
        const log = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
        json(response, 200, { log }); return true
      }

      // ---- shared data sync (delta by revision, last-write-wins per record) ----
      if (method === 'POST' && pathname === '/api/em/sync') {
        const b = await body(request, SYNC_MAX_BODY)
        const state = readSync()
        let since = Number(b.since) || 0
        const reset = since > state.rev // server data was lost/restored: client must resend everything
        if (reset) since = 0
        let touched = false
        const changes = {}, writable = {}

        for (const [name, cfg] of Object.entries(COLLECTIONS)) {
          if (cfg.read && !cfg.read.has(user.role)) continue
          const canWrite = cfg.write.has(user.role)
          writable[name] = canWrite
          const store = (state.c[name] ||= {})
          const incoming = b.changes?.[name]
          if (canWrite && Array.isArray(incoming)) {
            for (const env of incoming) {
              if (!env || typeof env.id !== 'string' || !/^[\w.\-]{1,64}$/.test(env.id) || typeof env.updatedAt !== 'string') continue
              const cur = store[env.id]
              if (cur && env.updatedAt <= cur.updatedAt) continue
              state.rev++
              store[env.id] = { id: env.id, updatedAt: env.updatedAt, deleted: !!env.deleted, data: env.deleted ? undefined : env.data, _rev: state.rev }
              touched = true
            }
          }
          changes[name] = Object.values(store).filter(e => e._rev > since).map(e =>
            cfg.redact && !canWrite && e.data ? { ...e, data: redactShelter(e.data) } : e)
        }
        if (touched) writeAtomic(syncFile, state)
        json(response, 200, { rev: state.rev, reset, changes, writable }); return true
      }

      // ---- user management (admin) ----
      if (pathname === '/api/auth/users' || pathname.startsWith('/api/auth/users/')) {
        if (!isAdmin) { text(response, 403, 'Forbidden'); return true }
        const users = readUsers()
        const id = pathname.split('/')[4]

        if (method === 'GET' && !id) { json(response, 200, { users: users.map(publicUser) }); return true }

        if (method === 'POST' && !id) {
          const b = await body(request)
          const username = String(b.username || '').trim()
          if (!/^[\w.\-@]{2,40}$/.test(username)) { text(response, 400, 'שם משתמש לא תקין (אותיות לטיניות, מספרים, . _ - @)'); return true }
          if (!ROLES.includes(b.role)) { text(response, 400, 'תפקיד לא תקין'); return true }
          if (String(b.password || '').length < MIN_PASSWORD) { text(response, 400, `סיסמה זמנית: לפחות ${MIN_PASSWORD} תווים`); return true }
          if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) { text(response, 409, 'שם משתמש כבר קיים'); return true }
          const nu = {
            id: randomUUID(), username, displayName: String(b.displayName || username).trim().slice(0, 80), role: b.role,
            ...(await hashPassword(String(b.password))), mustChangePassword: true, locked: false,
            createdAt: new Date().toISOString(), lastLogin: null,
          }
          users.push(nu); writeUsers(users)
          audit(user, 'ADD_USER', username, `תפקיד: ${b.role}`)
          json(response, 201, { user: publicUser(nu) }); return true
        }

        const target = users.find(u => u.id === id)
        if (!target) { text(response, 404, 'User not found'); return true }
        const wouldLoseLastAdmin = (nextRole, nextLocked) =>
          target.role === 'admin' && !target.locked && (nextRole !== 'admin' || nextLocked) && adminCount(users) <= 1

        if (method === 'PATCH') {
          const b = await body(request)
          if (b.role !== undefined && !ROLES.includes(b.role)) { text(response, 400, 'תפקיד לא תקין'); return true }
          const nextRole = b.role ?? target.role
          const nextLocked = b.locked ?? target.locked
          if (target.id === user.id && (nextLocked || nextRole !== target.role)) { text(response, 400, 'אי אפשר לשנות את תפקידך או לנעול את עצמך'); return true }
          if (wouldLoseLastAdmin(nextRole, !!nextLocked)) { text(response, 400, 'חייב להישאר לפחות מנהל מערכת פעיל אחד'); return true }
          if (b.displayName !== undefined) target.displayName = String(b.displayName).trim().slice(0, 80) || target.username
          target.role = nextRole
          target.locked = !!nextLocked
          if (b.password !== undefined) {
            if (String(b.password).length < MIN_PASSWORD) { text(response, 400, `סיסמה זמנית: לפחות ${MIN_PASSWORD} תווים`); return true }
            Object.assign(target, await hashPassword(String(b.password)), { mustChangePassword: true })
          }
          writeUsers(users)
          if (b.password !== undefined || target.locked || b.role !== undefined) killSessions(target.id)
          audit(user, b.password !== undefined ? 'RESET_PASSWORD' : 'EDIT_USER', target.username, JSON.stringify({ role: b.role, locked: b.locked }))
          json(response, 200, { user: publicUser(target) }); return true
        }

        if (method === 'DELETE') {
          if (target.id === user.id) { text(response, 400, 'אי אפשר למחוק את עצמך'); return true }
          if (wouldLoseLastAdmin('x', true)) { text(response, 400, 'חייב להישאר לפחות מנהל מערכת פעיל אחד'); return true }
          writeUsers(users.filter(u => u.id !== id))
          killSessions(id)
          audit(user, 'DELETE_USER', target.username, '')
          json(response, 200, { ok: true }); return true
        }
      }

      text(response, 404, 'Not found'); return true
    } catch (err) {
      text(response, err.status || 500, err.status ? 'Bad request' : 'Server error')
      return true
    }
  }

  // for /api/proxy and other guarded routes
  const requireSession = (request) => sessionFor(request)?.user || null

  return { init, resetAdmin, handle, requireSession, audit }
}
