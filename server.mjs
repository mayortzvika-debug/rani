import { createServer } from 'node:http'
import { mkdirSync, existsSync, readFileSync, writeFileSync, createReadStream } from 'node:fs'
import { extname, join, resolve, basename, sep } from 'node:path'
import { createEmApi } from './em-auth.mjs'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(__dirname)
const distDir = join(rootDir, 'dist')
const publicDir = join(rootDir, 'public')
const storageDir = resolve(process.env.STORAGE_DIR || join(rootDir, 'storage'))
const uploadsDir = join(storageDir, 'uploads')
const stateFile = join(storageDir, 'sessions.json')
const port = Number(process.env.PORT || 4173)

mkdirSync(storageDir, { recursive: true })
mkdirSync(uploadsDir, { recursive: true })

if (!existsSync(stateFile)) {
  writeFileSync(stateFile, JSON.stringify({ sessions: {} }, null, 2))
}

function readSessions() {
  return JSON.parse(readFileSync(stateFile, 'utf8'))
}

function writeSessions(data) {
  writeFileSync(stateFile, JSON.stringify(data, null, 2))
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function text(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(payload)
}

function readBody(request, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) { reject(new Error('Body too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function toSessionResponse(entry) {
  return {
    state: entry.state,
    updatedAt: entry.updatedAt,
  }
}

function setSession(sessionCode, state) {
  const db = readSessions()
  const updatedAt = new Date().toISOString()
  db.sessions[sessionCode] = { state, updatedAt }
  writeSessions(db)
  return db.sessions[sessionCode]
}

function getSession(sessionCode) {
  const db = readSessions()
  return db.sessions[sessionCode] ?? null
}

// Resolve a request path under baseDir; null if it escapes baseDir
function safeJoin(baseDir, relPath) {
  const full = resolve(baseDir, relPath.replace(/^\/+/, ''))
  return full === baseDir || full.startsWith(baseDir + sep) ? full : null
}

function sendFile(response, filePath) {
  const ext = extname(filePath).toLowerCase()
  const contentType =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.ico': 'image/x-icon',
    }[ext] ?? 'application/octet-stream'

  // HTML and JS/CSS must never be cached (no content hashes in filenames)
  const cacheControl = ['.html', '.js', '.css'].includes(ext)
    ? 'no-store, no-cache, must-revalidate'
    : 'public, max-age=31536000, immutable'

  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl })
  createReadStream(filePath).pipe(response)
}

const em = createEmApi({ storageDir, json, text, readBody })
await em.init()
if (process.argv.includes('--reset-admin')) { await em.resetAdmin(); process.exit(0) }

createServer(async (request, response) => {
  if (!request.url) {
    text(response, 400, 'Missing URL')
    return
  }

  const url = new URL(request.url, `http://${request.headers.host}`)
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { text(response, 400, 'Bad URL'); return }
  if (pathname.includes('\0')) { text(response, 400, 'Bad URL'); return }
  const codeSeg = pathname.startsWith('/api/session/') ? pathname.split('/')[3] : undefined
  if (codeSeg !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(codeSeg)) { text(response, 400, 'Bad session code'); return }

  if (await em.handle(request, response, pathname)) return

  if (request.method === 'GET' && pathname === '/health') {
    json(response, 200, { ok: true, storageDir, updatedAt: new Date().toISOString() })
    return
  }

  // GET session
  if (request.method === 'GET' && pathname.startsWith('/api/session/') && pathname.split('/').length === 4) {
    const sessionCode = pathname.split('/')[3]
    const session = getSession(sessionCode)
    if (!session) { text(response, 404, 'Session not found'); return }
    json(response, 200, toSessionResponse(session))
    return
  }

  // POST /api/session — create
  if (request.method === 'POST' && pathname === '/api/session') {
    const body = JSON.parse(String(await readBody(request) || '{}'))
    const sessionCode = (body.sessionCode || '').toUpperCase()
    if (!sessionCode || !body.state) { text(response, 400, 'Missing session payload'); return }
    const created = setSession(sessionCode, { ...body.state, sessionCode })
    json(response, 201, toSessionResponse(created))
    return
  }

  // PUT /api/session/:code — update full state
  if (request.method === 'PUT' && pathname.startsWith('/api/session/') && pathname.split('/').length === 4) {
    const sessionCode = pathname.split('/')[3]
    const body = JSON.parse(String(await readBody(request) || '{}'))
    const saved = setSession(sessionCode, { ...body, sessionCode })
    json(response, 200, toSessionResponse(saved))
    return
  }

  // POST /api/session/:code/join — register player
  if (request.method === 'POST' && pathname.startsWith('/api/session/') && pathname.endsWith('/join')) {
    const sessionCode = pathname.split('/')[3]
    const session = getSession(sessionCode)
    if (!session) { text(response, 404, 'Session not found'); return }

    const body = JSON.parse(String(await readBody(request) || '{}'))
    const players = Array.isArray(session.state.players) ? [...session.state.players] : []
    const existingIdx = players.findIndex((p) => p.deviceId === body.deviceId)

    if (existingIdx >= 0) {
      players[existingIdx] = { ...players[existingIdx], name: body.name }
    } else {
      players.push({ deviceId: body.deviceId, name: body.name, joinedAt: new Date().toISOString() })
    }

    const saved = setSession(sessionCode, { ...session.state, players })
    json(response, 200, toSessionResponse(saved))
    return
  }

  // POST /api/session/:code/vote — record vote
  if (request.method === 'POST' && pathname.startsWith('/api/session/') && pathname.endsWith('/vote')) {
    const sessionCode = pathname.split('/')[3]
    const session = getSession(sessionCode)
    if (!session) { text(response, 404, 'Session not found'); return }

    const body = JSON.parse(String(await readBody(request) || '{}'))
    console.log(`[vote] session=${sessionCode} round=${body.roundId} story=${body.storyIndex} voter=${body.voterName}`)

    if (body.roundId === undefined || body.storyIndex === undefined) {
      text(response, 400, 'Missing roundId or storyIndex'); return
    }

    const votes = Array.isArray(session.state.votes) ? session.state.votes : []
    const nextVotes = votes.filter(
      (vote) => !(vote.roundId === body.roundId && vote.deviceId === body.deviceId),
    )
    nextVotes.push({
      id: `vote-${Date.now()}`,
      roundId: body.roundId,
      storyIndex: Number(body.storyIndex),  // 0 = Story 1, 1 = Story 2
      deviceId: body.deviceId,
      voterName: body.voterName || 'אורח',
      createdAt: new Date().toISOString(),
    })

    const saved = setSession(sessionCode, { ...session.state, votes: nextVotes })
    json(response, 200, toSessionResponse(saved))
    return
  }

  // DELETE /api/session/:code/votes/:roundId — clear round votes
  if (request.method === 'DELETE' && pathname.startsWith('/api/session/') && pathname.includes('/votes/')) {
    const parts = pathname.split('/')
    const sessionCode = parts[3]
    const roundId = parts[5]
    const session = getSession(sessionCode)
    if (!session) { text(response, 404, 'Session not found'); return }

    const saved = setSession(sessionCode, {
      ...session.state,
      votes: session.state.votes.filter((vote) => vote.roundId !== roundId),
    })
    json(response, 200, toSessionResponse(saved))
    return
  }

  // POST /api/session/:code/upload/:roundId — upload video
  // Query params: ?filename=name.mp4&field=storiesVideo|revealVideo
  if (request.method === 'POST' && pathname.startsWith('/api/session/') && pathname.includes('/upload/')) {
    const parts = pathname.split('/')
    const sessionCode = parts[3]
    const roundId = parts[5]
    const session = getSession(sessionCode)
    if (!session) { text(response, 404, 'Session not found'); return }

    const safeName = basename(url.searchParams.get('filename') || `${roundId}.mp4`).replace(/[^\w.\-() ]/g, '_')
    const field = url.searchParams.get('field') === 'revealVideo' ? 'revealVideo' : 'storiesVideo'
    const sessionUploadDir = join(uploadsDir, sessionCode)
    mkdirSync(sessionUploadDir, { recursive: true })
    const fileName = `${roundId}-${field}-${Date.now()}${extname(safeName) || '.mp4'}`
    const targetPath = join(sessionUploadDir, fileName)
    writeFileSync(targetPath, await readBody(request))

    const videoUrl = `/uploads/${sessionCode}/${fileName}`
    const urlKey = field === 'revealVideo' ? 'revealVideoUrl' : 'storiesVideoUrl'
    const nameKey = field === 'revealVideo' ? 'revealVideoName' : 'storiesVideoName'

    const saved = setSession(sessionCode, {
      ...session.state,
      rounds: session.state.rounds.map((round) =>
        round.id === roundId ? { ...round, [urlKey]: videoUrl, [nameKey]: safeName } : round,
      ),
    })
    json(response, 200, toSessionResponse(saved))
    return
  }

  // CORS proxy for emergency dashboard (Google Apps Script + Nominatim + Red Alert)
  if (pathname === '/api/proxy' && request.method !== 'OPTIONS') {
    if (!em.requireSession(request)) { text(response, 401, 'Not authenticated'); return }
    const ALLOWED_HOSTS = [
      'script.google.com',
      'script.googleusercontent.com',
      'nominatim.openstreetmap.org',
      'www.oref.org.il',
      'oref.org.il',
    ]
    try {
      let targetUrl = null
      let parsedBody = null
      if (request.method === 'GET') {
        targetUrl = url.searchParams.get('url')
      } else {
        const bodyText = String(await readBody(request))
        try {
          parsedBody = JSON.parse(bodyText)
          targetUrl = parsedBody.url
        } catch {
          targetUrl = new URLSearchParams(bodyText).get('url')
        }
      }
      if (!targetUrl) { text(response, 400, 'Missing url parameter'); return }
      const parsedTarget = new URL(targetUrl)
      if (!ALLOWED_HOSTS.some(h => parsedTarget.hostname === h || parsedTarget.hostname.endsWith('.' + h))) {
        text(response, 403, 'Host not allowed: ' + parsedTarget.hostname); return
      }
      const upstreamMethod = (parsedBody?.method || (request.method === 'GET' ? 'GET' : 'POST')).toUpperCase()
      const fetchOptions = {
        method: upstreamMethod,
        headers: {
          'User-Agent': 'EmergencyDashboard/1.0',
          'Accept': 'application/json, */*',
          ...(parsedBody?.headers || {}),
        },
      }
      if (upstreamMethod !== 'GET' && parsedBody?.body) {
        fetchOptions.body = JSON.stringify(parsedBody.body)
        fetchOptions.headers['Content-Type'] = 'application/json'
      }
      const upstream = await fetch(targetUrl, fetchOptions)
      const upstreamText = await upstream.text()
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      })
      response.end(upstreamText)
    } catch (err) {
      text(response, 502, 'Proxy error: ' + err.message)
    }
    return
  }

  // Serve uploaded files
  if (pathname.startsWith('/uploads/')) {
    const filePath = safeJoin(uploadsDir, pathname.replace(/^\/uploads\//, ''))
    if (filePath && existsSync(filePath)) { sendFile(response, filePath); return }
  }

  // The dashboard lives in public/emergency — make /emergency and /emergency/ open it
  if (request.method === 'GET' && (pathname === '/emergency' || pathname === '/emergency/')) {
    sendFile(response, join(publicDir, 'emergency', 'index.html')); return
  }

  // Serve built frontend assets
  const assetPath = pathname === '/' ? join(distDir, 'index.html') : safeJoin(distDir, pathname)
  if (assetPath && existsSync(assetPath) && !pathname.endsWith('/')) { sendFile(response, assetPath); return }

  const publicPath = safeJoin(publicDir, pathname)
  if (publicPath && existsSync(publicPath) && !pathname.endsWith('/')) { sendFile(response, publicPath); return }

  if (existsSync(join(distDir, 'index.html'))) { sendFile(response, join(distDir, 'index.html')); return }

  text(response, 404, 'Not found')
}).listen(port, '0.0.0.0', () => {
  console.log(`Birthday app server is running on http://0.0.0.0:${port}`)
})
