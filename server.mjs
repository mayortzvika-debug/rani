import { createServer } from 'node:http'
import { mkdirSync, existsSync, readFileSync, writeFileSync, createReadStream } from 'node:fs'
import { extname, join, resolve, basename } from 'node:path'
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

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
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

  response.writeHead(200, { 'Content-Type': contentType })
  createReadStream(filePath).pipe(response)
}

createServer(async (request, response) => {
  if (!request.url) {
    text(response, 400, 'Missing URL')
    return
  }

  const url = new URL(request.url, `http://${request.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)

  if (request.method === 'GET' && pathname === '/health') {
    json(response, 200, {
      ok: true,
      storageDir,
      updatedAt: new Date().toISOString(),
    })
    return
  }

  if (request.method === 'GET' && pathname.startsWith('/api/session/')) {
    const sessionCode = pathname.split('/')[3]
    const session = getSession(sessionCode)

    if (!session) {
      text(response, 404, 'Session not found')
      return
    }

    json(response, 200, toSessionResponse(session))
    return
  }

  if (request.method === 'POST' && pathname === '/api/session') {
    const body = JSON.parse(String(await readBody(request) || '{}'))
    const sessionCode = (body.sessionCode || '').toUpperCase()

    if (!sessionCode || !body.state) {
      text(response, 400, 'Missing session payload')
      return
    }

    const created = setSession(sessionCode, { ...body.state, sessionCode })
    json(response, 201, toSessionResponse(created))
    return
  }

  if (request.method === 'PUT' && pathname.startsWith('/api/session/')) {
    const parts = pathname.split('/')
    const sessionCode = parts[3]

    if (parts.length !== 4) {
      text(response, 404, 'Unknown API route')
      return
    }

    const body = JSON.parse(String(await readBody(request) || '{}'))
    const saved = setSession(sessionCode, { ...body, sessionCode })
    json(response, 200, toSessionResponse(saved))
    return
  }

  if (request.method === 'POST' && pathname.startsWith('/api/session/') && pathname.includes('/vote')) {
    const sessionCode = pathname.split('/')[3]
    const session = getSession(sessionCode)

    if (!session) {
      text(response, 404, 'Session not found')
      return
    }

    const body = JSON.parse(String(await readBody(request) || '{}'))
    const nextVotes = session.state.votes.filter((vote) => !(vote.roundId === body.roundId && vote.deviceId === body.deviceId))
    nextVotes.push({
      id: `vote-${Date.now()}`,
      roundId: body.roundId,
      choiceIndex: body.choiceIndex,
      deviceId: body.deviceId,
      voterName: body.voterName,
      createdAt: new Date().toISOString(),
    })

    const saved = setSession(sessionCode, {
      ...session.state,
      votes: nextVotes,
    })

    json(response, 200, toSessionResponse(saved))
    return
  }

  if (request.method === 'DELETE' && pathname.startsWith('/api/session/') && pathname.includes('/votes/')) {
    const parts = pathname.split('/')
    const sessionCode = parts[3]
    const roundId = parts[5]
    const session = getSession(sessionCode)

    if (!session) {
      text(response, 404, 'Session not found')
      return
    }

    const saved = setSession(sessionCode, {
      ...session.state,
      votingRoundId: session.state.votingRoundId === roundId ? null : session.state.votingRoundId,
      votes: session.state.votes.filter((vote) => vote.roundId !== roundId),
    })

    json(response, 200, toSessionResponse(saved))
    return
  }

  if (request.method === 'POST' && pathname.startsWith('/api/session/') && pathname.includes('/upload/')) {
    const parts = pathname.split('/')
    const sessionCode = parts[3]
    const roundId = parts[5]
    const session = getSession(sessionCode)

    if (!session) {
      text(response, 404, 'Session not found')
      return
    }

    const safeName = basename(url.searchParams.get('filename') || `${roundId}.mp4`).replace(/[^\w.\-() ]/g, '_')
    const sessionUploadDir = join(uploadsDir, sessionCode)
    mkdirSync(sessionUploadDir, { recursive: true })
    const fileName = `${roundId}-${Date.now()}${extname(safeName) || '.mp4'}`
    const targetPath = join(sessionUploadDir, fileName)
    const body = await readBody(request)
    writeFileSync(targetPath, body)

    const videoUrl = `/uploads/${sessionCode}/${fileName}`
    const saved = setSession(sessionCode, {
      ...session.state,
      rounds: session.state.rounds.map((round) =>
        round.id === roundId ? { ...round, videoUrl, videoName: safeName } : round,
      ),
    })

    json(response, 200, toSessionResponse(saved))
    return
  }

  if (pathname.startsWith('/uploads/')) {
    const filePath = join(storageDir, pathname.replace(/^\//, ''))
    if (existsSync(filePath)) {
      sendFile(response, filePath)
      return
    }
  }

  const assetPath = pathname === '/' ? join(distDir, 'index.html') : join(distDir, pathname.replace(/^\//, ''))
  if (existsSync(assetPath) && !pathname.endsWith('/')) {
    sendFile(response, assetPath)
    return
  }

  const publicPath = join(publicDir, pathname.replace(/^\//, ''))
  if (existsSync(publicPath) && !pathname.endsWith('/')) {
    sendFile(response, publicPath)
    return
  }

  if (existsSync(join(distDir, 'index.html'))) {
    sendFile(response, join(distDir, 'index.html'))
    return
  }

  text(response, 404, 'Not found')
}).listen(port, '0.0.0.0', () => {
  console.log(`Birthday app server is running on http://0.0.0.0:${port}`)
})
