import { useEffect, useMemo, useState } from 'react'
import './App.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type GameRound = {
  id: string
  title: string
  prompt: string
  accent: string
  storiesVideoUrl: string   // סרטון אחד עם שני הסיפורים
  storiesVideoName: string
  revealVideoUrl: string    // סרטון חשיפה — מראה מה היה האמת
  revealVideoName: string
  correctStory: 1 | 2 | null
  votingOpenedAt: string | null  // לחישוב בונוס מהירות
}

type PlayerRecord = {
  deviceId: string
  name: string
  joinedAt: string
}

type VoteRecord = {
  id: string
  roundId: string
  storyIndex: 0 | 1   // 0 = Story 1, 1 = Story 2
  deviceId: string
  voterName: string
  createdAt: string
}

type GamePhase = 'setup' | 'lobby' | 'round' | 'reveal' | 'final'

type HostState = {
  eventName: string
  sessionCode: string
  phase: GamePhase
  currentRoundIndex: number
  rounds: GameRound[]
  votes: VoteRecord[]
  players: PlayerRecord[]
  votingOpen: boolean
}

type SessionResponse = {
  state: HostState
  updatedAt: string
}

type ScoreEntry = { deviceId: string; name: string; score: number }

// ─── Constants ────────────────────────────────────────────────────────────────

const DEVICE_KEY = 'birthday-battle-device-id'
const NAME_KEY = 'birthday-battle-player-name'
const HOST_SESSION_KEY = 'birthday-battle-host-session'
const ACCENTS = ['#ff6b6b', '#ffd166', '#06d6a0', '#8a7dff', '#ff9f1c', '#2ec4b6']

// ─── Utils ────────────────────────────────────────────────────────────────────

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const next = `device-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  localStorage.setItem(DEVICE_KEY, next)
  return next
}

function createCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function makeRound(index: number): GameRound {
  return {
    id: `round-${Date.now()}-${index}`,
    title: `שאלה ${index + 1}`,
    prompt: 'מה הסיפור האמיתי?',
    accent: ACCENTS[index % ACCENTS.length],
    storiesVideoUrl: '',
    storiesVideoName: '',
    revealVideoUrl: '',
    revealVideoName: '',
    correctStory: null,
    votingOpenedAt: null,
  }
}

// Migrate sessions saved with old field names (video1Url/video2Url → storiesVideoUrl/revealVideoUrl)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateState(raw: any, sessionCode: string): HostState {
  const base = makeInitialState(sessionCode)
  if (!raw || typeof raw !== 'object') return base

  const rounds: GameRound[] = Array.isArray(raw.rounds)
    ? raw.rounds.map((r: any, i: number) => ({
        ...makeRound(i),
        ...r,
        // migrate old single-video field → storiesVideo
        storiesVideoUrl: r.storiesVideoUrl ?? r.videoUrl ?? r.video1Url ?? '',
        storiesVideoName: r.storiesVideoName ?? r.videoName ?? r.video1Name ?? '',
        // migrate old second video → revealVideo
        revealVideoUrl: r.revealVideoUrl ?? r.video2Url ?? '',
        revealVideoName: r.revealVideoName ?? r.video2Name ?? '',
        correctStory: r.correctStory ?? null,
        votingOpenedAt: r.votingOpenedAt ?? null,
      }))
    : base.rounds

  return {
    ...base,
    ...raw,
    sessionCode,
    phase: raw.phase ?? 'setup',
    currentRoundIndex: raw.currentRoundIndex ?? 0,
    votingOpen: raw.votingOpen ?? false,
    players: Array.isArray(raw.players) ? raw.players : [],
    votes: Array.isArray(raw.votes) ? raw.votes : [],
    rounds,
  }
}

function makeInitialState(sessionCode: string): HostState {
  return {
    eventName: 'אמת או שקר?',
    sessionCode,
    phase: 'setup',
    currentRoundIndex: 0,
    rounds: [makeRound(0), makeRound(1), makeRound(2)],
    votes: [],
    players: [],
    votingOpen: false,
  }
}

function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}?mode=player&session=${code}`
}

function qrUrl(code: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=12&data=${encodeURIComponent(joinUrl(code))}`
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error((await r.text()) || 'Request failed')
  return r.json() as Promise<T>
}

function phaseLabel(phase: GamePhase): string {
  return { setup: 'הגדרה', lobby: 'לובי', round: 'שאלה', reveal: 'חשיפה', final: 'סיום' }[phase]
}

const SPEED_WINDOW_MS = 20_000  // 20 שניות — חלון הבונוס
const BASE_POINTS = 1000
const MAX_SPEED_BONUS = 500

function speedBonus(votedAt: string, openedAt: string | null): number {
  if (!openedAt) return 0
  const elapsed = new Date(votedAt).getTime() - new Date(openedAt).getTime()
  return Math.max(0, Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - elapsed / SPEED_WINDOW_MS)))
}

function computeLeaderboard(rounds: GameRound[], votes: VoteRecord[]): ScoreEntry[] {
  const map = new Map<string, ScoreEntry>()
  for (const round of rounds) {
    if (round.correctStory === null) continue
    const correctIdx = round.correctStory - 1
    for (const v of votes.filter((v) => v.roundId === round.id)) {
      if (!map.has(v.deviceId))
        map.set(v.deviceId, { deviceId: v.deviceId, name: v.voterName, score: 0 })
      if (v.storyIndex === correctIdx) {
        map.get(v.deviceId)!.score += BASE_POINTS + speedBonus(v.createdAt, round.votingOpenedAt)
      }
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VideoSlot({
  label,
  colorClass,
  url,
  name,
  onUrl,
  onFile,
}: {
  label: string
  colorClass: string
  url: string
  name: string
  onUrl: (url: string) => void
  onFile: (f: File) => void
}) {
  return (
    <div className={`video-slot ${colorClass}`}>
      <div className="slot-label">{label}</div>
      {url && <video className="slot-preview" src={url} controls />}
      <label className="upload-label">
        <input
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        {name ? `✓ ${name.slice(0, 30)}` : '+ העלה סרטון'}
      </label>
      <input
        className="field"
        placeholder="או הזן כתובת URL"
        value={url}
        onChange={(e) => onUrl(e.target.value)}
      />
    </div>
  )
}

function RevealBar({
  label,
  votes,
  total,
  isCorrect,
  fillClass,
}: {
  label: string
  votes: number
  total: number
  isCorrect: boolean
  fillClass: string
}) {
  const pct = total > 0 ? Math.round((votes / total) * 100) : 0
  return (
    <div className={`reveal-bar-wrap ${isCorrect ? 'correct-story' : 'wrong-story'}`}>
      <div className="reveal-bar-head">
        <span>
          {label} {isCorrect ? '✓ נכון!' : ''}
        </span>
        <span>
          {votes} ({pct}%)
        </span>
      </div>
      <div className="reveal-bar-track">
        <div className={`reveal-bar-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Leaderboard({ entries, myDeviceId }: { entries: ScoreEntry[]; myDeviceId?: string }) {
  return (
    <div className="board-list">
      {entries.map((e, i) => (
        <div
          key={e.deviceId}
          className={[
            'board-row',
            e.deviceId === myDeviceId ? 'me' : '',
            i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="rank">
            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
          </span>
          <span className="pname">{e.name}</span>
          <span className="score">{e.score}</span>
        </div>
      ))}
      {entries.length === 0 && <p className="muted">לא נרשמו הצבעות עדיין</p>}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const params = new URLSearchParams(location.search)
  const modeParam = params.get('mode')
  const isHost = modeParam !== 'player' && modeParam !== 'voter'
  const urlSession = params.get('session')?.toUpperCase()

  const [deviceId] = useState(getDeviceId)
  const [sessionCode] = useState(() => {
    if (urlSession) {
      // URL has a session code — remember it for next visit
      if (isHost) localStorage.setItem(HOST_SESSION_KEY, urlSession)
      return urlSession
    }
    if (isHost) {
      // No code in URL — reuse last host session so videos aren't lost
      const saved = localStorage.getItem(HOST_SESSION_KEY)
      if (saved) return saved
    }
    const next = createCode()
    if (isHost) localStorage.setItem(HOST_SESSION_KEY, next)
    return next
  })
  const [state, setState] = useState<HostState>(() => makeInitialState(sessionCode))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // Player-specific
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [nameInput, setNameInput] = useState('')
  // joined is persisted — survive page reload
  const [joined, setJoined] = useState(() => !!localStorage.getItem(NAME_KEY))
  const [myVote, setMyVote] = useState<0 | 1 | null>(null)
  const [voteError, setVoteError] = useState('')

  // Host-specific
  const [showSetup, setShowSetup] = useState(false)
  const [copied, setCopied] = useState(false)

  // ── Load session ──────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/session/${sessionCode}`)
        if (res.status === 404 && isHost) {
          const created = await api<SessionResponse>('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode, state: makeInitialState(sessionCode) }),
          })
          setState(created.state)
        } else if (res.ok) {
          const data = (await res.json()) as SessionResponse
          setState(migrateState(data.state, sessionCode))
        } else {
          setError('לא נמצא המשחק. בדוק את הקוד.')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה בטעינה')
      } finally {
        setLoading(false)
      }
    })()
  }, [sessionCode, isHost])

  // ── Poll — always active (host needs live vote counts during round/reveal) ─
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const data = await api<SessionResponse>(`/api/session/${sessionCode}`)
        setState(migrateState(data.state, sessionCode))
      } catch {
        // keep showing current state
      }
    }, 2000)
    return () => clearInterval(id)
  }, [sessionCode])

  // Reset vote on round change
  useEffect(() => {
    setMyVote(null)
  }, [state.currentRoundIndex])

  const currentRound = state.rounds[state.currentRoundIndex] ?? state.rounds[0]
  const roundVotes = state.votes.filter((v) => v.roundId === currentRound?.id)
  const leaderboard = useMemo(
    () => computeLeaderboard(state.rounds, state.votes),
    [state.rounds, state.votes],
  )

  // ── Host helpers ──────────────────────────────────────────────────────────
  const persist = async (next: HostState) => {
    setState(next)
    const r = await api<SessionResponse>(`/api/session/${next.sessionCode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    setState(r.state)
    return r.state
  }

  const updateRound = (id: string, patch: Partial<GameRound>) =>
    persist({ ...state, rounds: state.rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  const uploadVideo = async (roundId: string, field: 'storiesVideo' | 'revealVideo', file: File) => {
    setStatusMsg('מעלה סרטון...')
    try {
      const r = await api<{ state: HostState }>(
        `/api/session/${sessionCode}/upload/${roundId}?filename=${encodeURIComponent(file.name)}&field=${field}`,
        { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file },
      )
      setState(r.state)
      setStatusMsg('✓ הסרטון עלה בהצלחה')
      setTimeout(() => setStatusMsg(''), 2500)
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'שגיאה בהעלאה')
    }
  }

  const addRound = () =>
    persist({ ...state, rounds: [...state.rounds, makeRound(state.rounds.length)] })

  const removeRound = (id: string) => {
    const next = state.rounds.filter((r) => r.id !== id)
    if (!next.length) return
    persist({
      ...state,
      rounds: next,
      currentRoundIndex: Math.min(state.currentRoundIndex, next.length - 1),
    })
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(joinUrl(sessionCode))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Player helpers ────────────────────────────────────────────────────────
  const joinGame = async () => {
    const name = nameInput.trim()
    if (!name) return
    try {
      await api<SessionResponse>(`/api/session/${sessionCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, name }),
      })
      localStorage.setItem(NAME_KEY, name)
      setPlayerName(name)
      setJoined(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהצטרפות')
    }
  }

  const submitVote = async (storyIndex: 0 | 1) => {
    if (!currentRound || !state.votingOpen) return
    setMyVote(storyIndex)
    setVoteError('')
    try {
      const res = await api<SessionResponse>(`/api/session/${sessionCode}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: currentRound.id, storyIndex, deviceId, voterName: playerName }),
      })
      setState(res.state)
    } catch (e) {
      setVoteError(e instanceof Error ? e.message : 'שגיאה בשליחת ההצבעה — נסה שוב')
      setMyVote(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="shell">
        <div className="center-screen">
          <div className="spinner" />
          <p>טוענים את המשחק...</p>
        </div>
      </div>
    )
  }

  // ══════════════════════════════ HOST SCREEN ═══════════════════════════════
  if (isHost) {
    return (
      <div className="shell">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="host-shell">
          {/* Banner */}
          <img src="/banner.png" alt="מה באמת קרה?" className="game-banner" />

          {/* Header */}
          <header className="host-header">
            <div>
              <p className="eyebrow">מארח</p>
              <h1>{state.eventName}</h1>
            </div>
            <div className="header-right">
              <span className="phase-badge">{phaseLabel(state.phase)}</span>
              {statusMsg && <span className="status-msg">{statusMsg}</span>}
              <button className="ghost-btn" onClick={() => setShowSetup((s) => !s)}>
                {showSetup ? '✕ סגור עריכה' : '⚙ עריכת משחק'}
              </button>
            </div>
          </header>

          {/* Setup editor (collapsible) */}
          {showSetup && (
            <section className="setup-panel panel">
              <div className="setup-header">
                <h2>הגדרות משחק</h2>
                <button className="add-btn" onClick={() => void addRound()}>
                  + הוסף שאלה
                </button>
              </div>
              <div className="field-row">
                <label>שם האירוע</label>
                <input
                  className="field"
                  value={state.eventName}
                  onChange={(e) => void persist({ ...state, eventName: e.target.value })}
                />
              </div>

              {state.rounds.map((round) => (
                <div
                  key={round.id}
                  className="round-editor panel"
                  style={{ '--accent': round.accent } as React.CSSProperties}
                >
                  <div className="round-editor-head">
                    <input
                      className="field round-title-input"
                      value={round.title}
                      onChange={(e) => void updateRound(round.id, { title: e.target.value })}
                    />
                    <button className="danger-btn" onClick={() => void removeRound(round.id)}>
                      ✕
                    </button>
                  </div>

                  <textarea
                    className="field"
                    value={round.prompt}
                    rows={2}
                    onChange={(e) => void updateRound(round.id, { prompt: e.target.value })}
                  />

                  <div className="story-slots">
                    <VideoSlot
                      label="🎬 סרטון שאלה (שני הסיפורים)"
                      colorClass="slot-story-1"
                      url={round.storiesVideoUrl}
                      name={round.storiesVideoName}
                      onUrl={(url) => void updateRound(round.id, { storiesVideoUrl: url, storiesVideoName: url })}
                      onFile={(f) => void uploadVideo(round.id, 'storiesVideo', f)}
                    />
                    <VideoSlot
                      label="🔍 סרטון חשיפה (מה האמת)"
                      colorClass="slot-story-2"
                      url={round.revealVideoUrl}
                      name={round.revealVideoName}
                      onUrl={(url) => void updateRound(round.id, { revealVideoUrl: url, revealVideoName: url })}
                      onFile={(f) => void uploadVideo(round.id, 'revealVideo', f)}
                    />
                  </div>

                  <div className="correct-pick">
                    <span>הסיפור האמיתי:</span>
                    <button
                      className={`story-tag ${round.correctStory === 1 ? 'story-1-active' : ''}`}
                      onClick={() =>
                        void updateRound(round.id, {
                          correctStory: round.correctStory === 1 ? null : 1,
                        })
                      }
                    >
                      סיפור 1
                    </button>
                    <button
                      className={`story-tag ${round.correctStory === 2 ? 'story-2-active' : ''}`}
                      onClick={() =>
                        void updateRound(round.id, {
                          correctStory: round.correctStory === 2 ? null : 2,
                        })
                      }
                    >
                      סיפור 2
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* PHASE: setup */}
          {state.phase === 'setup' && (
            <section className="panel info-panel">
              <div>
                <h2>המשחק מוכן להפעלה</h2>
                <p className="muted">
                  {state.rounds.length} שאלות •{' '}
                  {state.rounds.filter((r) => r.correctStory !== null).length} עם תשובה מוגדרת
                </p>
              </div>
              <button
                className="primary-btn"
                onClick={() => void persist({ ...state, phase: 'lobby' })}
              >
                צור לובי →
              </button>
            </section>
          )}

          {/* PHASE: lobby */}
          {state.phase === 'lobby' && (
            <section className="panel">
              <div className="lobby-grid">
                <div className="qr-section">
                  <img src={qrUrl(sessionCode)} alt="QR להצטרפות" className="qr-img" />
                  <div className="session-code">{sessionCode}</div>
                  <button className="ghost-btn" onClick={() => void copyLink()}>
                    {copied ? '✓ הועתק' : 'העתק קישור'}
                  </button>
                </div>
                <div className="players-section">
                  <h3>שחקנים שהצטרפו ({state.players.length})</h3>
                  <div className="players-list">
                    {state.players.length === 0 ? (
                      <p className="muted">ממתינים לשחקנים...</p>
                    ) : (
                      state.players.map((p) => (
                        <div key={p.deviceId} className="player-chip">
                          {p.name}
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    className="primary-btn"
                    disabled={state.players.length === 0}
                    onClick={() =>
                      void persist({
                        ...state,
                        phase: 'round',
                        currentRoundIndex: 0,
                        votingOpen: false,
                      })
                    }
                  >
                    התחל משחק ({state.players.length} שחקנים)
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* PHASE: round */}
          {state.phase === 'round' && currentRound && (
            <section
              className="panel round-panel"
              style={{ '--accent': currentRound.accent } as React.CSSProperties}
            >
              <div className="round-header">
                <div>
                  <span className="round-num">
                    שאלה {state.currentRoundIndex + 1} / {state.rounds.length}
                  </span>
                  <h2>{currentRound.title}</h2>
                  <p className="prompt">{currentRound.prompt}</p>
                </div>
                <div className="vote-count-badge">
                  <span>{roundVotes.length}</span>
                  <small>הצבעות</small>
                </div>
              </div>

              <div className="single-video">
                {currentRound.storiesVideoUrl ? (
                  <video className="video-player-full" controls src={currentRound.storiesVideoUrl} />
                ) : (
                  <div className="video-empty">אין סרטון שאלה</div>
                )}
              </div>

              <div className="round-controls">
                {!state.votingOpen ? (
                  <button
                    className="primary-btn"
                    onClick={() => {
                      const now = new Date().toISOString()
                      void persist({
                        ...state,
                        votingOpen: true,
                        rounds: state.rounds.map((r) =>
                          r.id === currentRound.id ? { ...r, votingOpenedAt: now } : r,
                        ),
                      })
                    }}
                  >
                    פתח הצבעה
                  </button>
                ) : (
                  <button
                    className="secondary-btn"
                    onClick={() => void persist({ ...state, votingOpen: false })}
                  >
                    סגור הצבעה
                  </button>
                )}
                <button
                  className="reveal-btn"
                  onClick={() => void persist({ ...state, phase: 'reveal', votingOpen: false })}
                >
                  חשוף תשובה →
                </button>
              </div>
            </section>
          )}

          {/* PHASE: reveal */}
          {state.phase === 'reveal' && currentRound && (
            <section className="panel reveal-panel">
              <div>
                <span className="round-num">
                  שאלה {state.currentRoundIndex + 1} — תוצאות
                </span>
                <h2>{currentRound.prompt}</h2>
              </div>

              {currentRound.revealVideoUrl && (
                <div className="single-video">
                  <video className="video-player-full" controls autoPlay src={currentRound.revealVideoUrl} />
                </div>
              )}

              <div className="reveal-bars">
                <RevealBar
                  label="סיפור 1"
                  votes={roundVotes.filter((v) => v.storyIndex === 0).length}
                  total={roundVotes.length}
                  isCorrect={currentRound.correctStory === 1}
                  fillClass="fill-story-1"
                />
                <RevealBar
                  label="סיפור 2"
                  votes={roundVotes.filter((v) => v.storyIndex === 1).length}
                  total={roundVotes.length}
                  isCorrect={currentRound.correctStory === 2}
                  fillClass="fill-story-2"
                />
              </div>

              <div className="interim-board">
                <h3>ניקוד עכשיו</h3>
                <Leaderboard entries={leaderboard.slice(0, 5)} />
              </div>

              <div className="round-controls">
                {state.currentRoundIndex < state.rounds.length - 1 ? (
                  <button
                    className="primary-btn"
                    onClick={() =>
                      void persist({
                        ...state,
                        phase: 'round',
                        currentRoundIndex: state.currentRoundIndex + 1,
                        votingOpen: false,
                      })
                    }
                  >
                    שאלה הבאה →
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    onClick={() => void persist({ ...state, phase: 'final', votingOpen: false })}
                  >
                    לוח תוצאות סופי 🏆
                  </button>
                )}
              </div>
            </section>
          )}

          {/* PHASE: final */}
          {state.phase === 'final' && (
            <section className="panel final-panel">
              <h2>🏆 לוח תוצאות סופי</h2>
              <Leaderboard entries={leaderboard} />
              <button
                className="ghost-btn"
                onClick={() =>
                  void persist({
                    ...state,
                    phase: 'setup',
                    currentRoundIndex: 0,
                    votingOpen: false,
                    votes: [],
                    players: [],
                  })
                }
              >
                משחק חדש
              </button>
            </section>
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════ PLAYER SCREEN ═════════════════════════════
  return (
    <div className="shell">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="player-shell">
        {/* JOIN */}
        {!joined && (
          <section className="panel join-panel">
            <img src="/banner.png" alt="מה באמת קרה?" className="join-banner" />
            <h1>{state.eventName}</h1>
            <p className="muted">הזן את שמך והצטרף למשחק</p>
            {error && <p className="error-msg">{error}</p>}
            <input
              className="field big-field"
              placeholder="השם שלך"
              value={nameInput}
              autoFocus
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void joinGame()}
            />
            <button
              className="primary-btn big-btn"
              disabled={!nameInput.trim()}
              onClick={() => void joinGame()}
            >
              הצטרף למשחק!
            </button>
          </section>
        )}

        {/* LOBBY */}
        {joined && state.phase === 'lobby' && (
          <section className="panel player-waiting">
            <p className="eyebrow">שלום, {playerName}!</p>
            <h2>ממתינים שהמשחק יתחיל...</h2>
            <div className="pulse-ring" />
            <p className="muted">{state.players.length} שחקנים הצטרפו</p>
          </section>
        )}

        {/* ROUND */}
        {joined && state.phase === 'round' && (
          <section className="panel player-vote">
            {!state.votingOpen ? (
              <div className="waiting-msg">
                <div className="pulse-ring" />
                <h2>👀 צפו בסרטונים על המסך</h2>
                <p className="muted">ההצבעה תיפתח בקרוב...</p>
              </div>
            ) : (
              <>
                <p className="eyebrow">שאלה {state.currentRoundIndex + 1}</p>
                <h2>{currentRound?.prompt}</h2>
                <p className="vote-instruction">מה הסיפור האמיתי?</p>
                <div className="vote-buttons">
                  <button
                    className={`vote-btn story-1-btn ${myVote === 0 ? 'selected' : ''}`}
                    onClick={() => void submitVote(0)}
                  >
                    <span className="story-num">1</span>
                    <span>סיפור 1</span>
                  </button>
                  <button
                    className={`vote-btn story-2-btn ${myVote === 1 ? 'selected' : ''}`}
                    onClick={() => void submitVote(1)}
                  >
                    <span className="story-num">2</span>
                    <span>סיפור 2</span>
                  </button>
                </div>
                {voteError && <p className="error-msg">{voteError}</p>}
                {myVote !== null && !voteError && (
                  <p className="voted-msg">✓ הצבעת! אפשר לשנות עד שהמארח יסגור.</p>
                )}
              </>
            )}
          </section>
        )}

        {/* REVEAL */}
        {joined && state.phase === 'reveal' && currentRound && (
          <section className="panel player-reveal">
            {(() => {
              const myVoteRecord = state.votes.find(
                (v) => v.roundId === currentRound.id && v.deviceId === deviceId,
              )
              const correct =
                currentRound.correctStory !== null && myVoteRecord
                  ? myVoteRecord.storyIndex === currentRound.correctStory - 1
                  : null
              const bonus = correct && myVoteRecord
                ? speedBonus(myVoteRecord.createdAt, currentRound.votingOpenedAt)
                : 0
              const roundPoints = correct ? BASE_POINTS + bonus : 0
              const myTotalScore = leaderboard.find((e) => e.deviceId === deviceId)?.score ?? 0
              return (
                <>
                  <div
                    className={`result-badge ${correct === true ? 'correct' : correct === false ? 'wrong' : 'neutral'}`}
                  >
                    {correct === true
                      ? `✓ נכון! +${roundPoints}`
                      : correct === false
                        ? '✗ טעות'
                        : '⏳'}
                  </div>
                  {correct === true && bonus > 0 && (
                    <p className="speed-bonus-label">⚡ בונוס מהירות: +{bonus}</p>
                  )}
                  <p className="correct-answer-label">
                    הסיפור הנכון:{' '}
                    <strong>סיפור {currentRound.correctStory ?? '?'}</strong>
                  </p>
                  <div className="my-score-row">
                    <span>סה״כ ניקוד:</span>
                    <strong>{myTotalScore}</strong>
                  </div>
                  <Leaderboard entries={leaderboard.slice(0, 3)} myDeviceId={deviceId} />
                </>
              )
            })()}
          </section>
        )}

        {/* FINAL */}
        {joined && state.phase === 'final' && (
          <section className="panel player-final">
            <h2>🏆 המשחק נגמר!</h2>
            {(() => {
              const myRank = leaderboard.findIndex((e) => e.deviceId === deviceId) + 1
              const myScore = leaderboard.find((e) => e.deviceId === deviceId)?.score ?? 0
              return (
                <>
                  <div className="my-final-result">
                    <div className="my-rank">#{myRank || '?'}</div>
                    <div className="my-name">{playerName}</div>
                    <div className="my-score-big">{myScore} נקודות</div>
                  </div>
                  <Leaderboard entries={leaderboard} myDeviceId={deviceId} />
                </>
              )
            })()}
          </section>
        )}

        {/* SETUP (waiting for host to open lobby) */}
        {joined && state.phase === 'setup' && (
          <section className="panel player-waiting">
            <h2>המשחק עוד לא התחיל</h2>
            <p className="muted">המארח מכין את המשחק...</p>
          </section>
        )}
      </div>
    </div>
  )
}
