import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import './App.css'

type GameRound = {
  id: string
  title: string
  prompt: string
  accent: string
  videoUrl: string
  videoName: string
  choices: string[]
}

type VoteRecord = {
  id: string
  roundId: string
  choiceIndex: number
  deviceId: string
  voterName: string
  createdAt: string
}

type HostState = {
  eventName: string
  eventDate: string
  welcomeTitle: string
  welcomeNote: string
  sessionCode: string
  currentRoundId: string
  votingRoundId: string | null
  rounds: GameRound[]
  votes: VoteRecord[]
}

type SessionResponse = {
  state: HostState
  updatedAt: string
}

const DEVICE_STORAGE_KEY = 'birthday-battle-device-id'

const INITIAL_ROUNDS: GameRound[] = [
  {
    id: 'round-1',
    title: 'סבב פתיחה',
    prompt: 'מי סיפק את הרגע הכי מצחיק בסרטון?',
    accent: '#ff6b6b',
    videoUrl: '/videos/round-1.mp4',
    videoName: 'public/videos/round-1.mp4',
    choices: ['נועה', 'איתי', 'מיה', 'תום'],
  },
  {
    id: 'round-2',
    title: 'סבב אמצע',
    prompt: 'איזה ביצוע היה הכי מפתיע?',
    accent: '#ffd166',
    videoUrl: '/videos/round-2.mp4',
    videoName: 'public/videos/round-2.mp4',
    choices: ['הצוות הכחול', 'הצוות הוורוד', 'הצוות הזהב', 'הצוות הירוק'],
  },
  {
    id: 'round-3',
    title: 'גמר',
    prompt: 'מי הזוכה הגדול של הערב?',
    accent: '#06d6a0',
    videoUrl: '/videos/round-3.mp4',
    videoName: 'public/videos/round-3.mp4',
    choices: ['מלך הרחבה', 'מלכת הרחבה', 'צמד השנה', 'בחירת הקהל'],
  },
]

function createInitialState(sessionCode: string): HostState {
  return {
    eventName: 'Battle Birthday Night',
    eventDate: 'הערב מתחיל בעוד רגע',
    welcomeTitle: 'סורקים, צופים, ואז מצביעים',
    welcomeNote: 'עכשיו אפשר גם להעלות סרטונים מהדפדפן וגם לשים קבצים קבועים בתיקיית public/videos.',
    sessionCode,
    currentRoundId: INITIAL_ROUNDS[0].id,
    votingRoundId: null,
    rounds: INITIAL_ROUNDS,
    votes: [],
  }
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function createSessionCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function getSearchParams() {
  return new URLSearchParams(window.location.search)
}

function getBaseUrl() {
  return `${window.location.origin}${window.location.pathname}`
}

function getJoinUrl(sessionCode: string) {
  return `${getBaseUrl()}?mode=voter&session=${sessionCode}`
}

function getQrUrl(sessionCode: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=16&data=${encodeURIComponent(getJoinUrl(sessionCode))}`
}

function getDeviceId() {
  const existingId = window.localStorage.getItem(DEVICE_STORAGE_KEY)

  if (existingId) {
    return existingId
  }

  const nextId = createId('device')
  window.localStorage.setItem(DEVICE_STORAGE_KEY, nextId)
  return nextId
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }

  return (await response.json()) as T
}

function App() {
  const initialParams = getSearchParams()
  const initialMode = initialParams.get('mode') === 'voter' ? 'voter' : 'host'
  const initialSession = initialParams.get('session')?.toUpperCase() ?? createSessionCode()

  const [mode, setMode] = useState<'host' | 'voter'>(initialMode)
  const [deviceId] = useState(() => getDeviceId())
  const [sessionCode, setSessionCode] = useState(initialSession)
  const [sessionInput, setSessionInput] = useState(initialSession)
  const [hostState, setHostState] = useState<HostState>(createInitialState(initialSession))
  const [updatedAt, setUpdatedAt] = useState('')
  const [copied, setCopied] = useState(false)
  const [voterName, setVoterName] = useState('')
  const [voterChoice, setVoterChoice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const currentRound = useMemo(
    () => hostState.rounds.find((round) => round.id === hostState.currentRoundId) ?? hostState.rounds[0],
    [hostState.currentRoundId, hostState.rounds],
  )

  const votingRound = useMemo(
    () => hostState.rounds.find((round) => round.id === hostState.votingRoundId) ?? null,
    [hostState.rounds, hostState.votingRoundId],
  )

  const leaderboard = useMemo(() => {
    if (!votingRound) {
      return []
    }

    const totalVotes = hostState.votes.filter((vote) => vote.roundId === votingRound.id)
    return votingRound.choices.map((choice, index) => ({
      choice,
      count: totalVotes.filter((vote) => vote.choiceIndex === index).length,
    }))
  }, [hostState.votes, votingRound])

  const activeRoundVotes = hostState.votingRoundId
    ? hostState.votes.filter((vote) => vote.roundId === hostState.votingRoundId).length
    : 0

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('mode', mode)
    params.set('session', sessionCode)
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }, [mode, sessionCode])

  useEffect(() => {
    const hydrateSession = async () => {
      try {
        setLoading(true)
        setMessage('')

        const existing = await fetch(`/api/session/${sessionCode}`)

        if (existing.status === 404 && mode === 'host') {
          const created = await requestJson<SessionResponse>('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode, state: createInitialState(sessionCode) }),
          })
          setHostState(created.state)
          setUpdatedAt(created.updatedAt)
          return
        }

        if (!existing.ok) {
          throw new Error(await existing.text())
        }

        const data = (await existing.json()) as SessionResponse
        setHostState(data.state)
        setUpdatedAt(data.updatedAt)
      } catch (error) {
        const nextMessage = error instanceof Error ? error.message : 'לא הצלחנו לטעון את הסשן'
        setMessage(nextMessage)
      } finally {
        setLoading(false)
      }
    }

    void hydrateSession()
  }, [mode, sessionCode])

  useEffect(() => {
    if (mode !== 'voter') {
      return
    }

    const interval = window.setInterval(async () => {
      try {
        const data = await requestJson<SessionResponse>(`/api/session/${sessionCode}`)
        setHostState(data.state)
        setUpdatedAt(data.updatedAt)
      } catch {
        // Keep the current screen state and retry on next poll.
      }
    }, 2000)

    return () => window.clearInterval(interval)
  }, [mode, sessionCode])

  useEffect(() => {
    if (!votingRound) {
      setVoterChoice(null)
    }
  }, [votingRound])

  const persistHostState = async (nextState: HostState) => {
    setHostState(nextState)

    const response = await requestJson<SessionResponse>(`/api/session/${nextState.sessionCode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextState),
    })

    setUpdatedAt(response.updatedAt)
    setHostState(response.state)
  }

  const updateRound = async (roundId: string, updater: (round: GameRound) => GameRound) => {
    const nextState = {
      ...hostState,
      rounds: hostState.rounds.map((round) => (round.id === roundId ? updater(round) : round)),
    }

    await persistHostState(nextState)
  }

  const handleVideoUpload = async (roundId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setMessage('מעלה את הסרטון לשרת...')

    try {
      const response = await requestJson<{ state: HostState; updatedAt: string }>(
        `/api/session/${sessionCode}/upload/${roundId}?filename=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        },
      )

      setHostState(response.state)
      setUpdatedAt(response.updatedAt)
      setMessage('הסרטון עלה בהצלחה ונשמר בשרת.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'העלאת הסרטון נכשלה')
    } finally {
      event.target.value = ''
    }
  }

  const openVoting = async (roundId: string) => {
    const nextState = {
      ...hostState,
      currentRoundId: roundId,
      votingRoundId: roundId,
    }

    await persistHostState(nextState)
  }

  const closeVoting = async () => {
    await persistHostState({
      ...hostState,
      votingRoundId: null,
    })
  }

  const clearVotesForRound = async (roundId: string) => {
    const response = await requestJson<SessionResponse>(`/api/session/${sessionCode}/votes/${roundId}`, {
      method: 'DELETE',
    })

    setHostState(response.state)
    setUpdatedAt(response.updatedAt)
  }

  const handleVoteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!votingRound || voterChoice === null) {
      return
    }

    setMessage('שומרים את ההצבעה שלך...')

    try {
      const response = await requestJson<SessionResponse>(`/api/session/${sessionCode}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundId: votingRound.id,
          choiceIndex: voterChoice,
          voterName: voterName.trim() || 'אורח/ת',
          deviceId,
        }),
      })

      setHostState(response.state)
      setUpdatedAt(response.updatedAt)
      setMessage('ההצבעה נשמרה. אפשר לעדכן בחירה כל עוד הסבב פתוח.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'לא הצלחנו לשמור את ההצבעה')
    }
  }

  const copyJoinUrl = async () => {
    await navigator.clipboard.writeText(getJoinUrl(sessionCode))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const connectToSession = () => {
    setSessionCode(sessionInput.toUpperCase())
  }

  if (loading) {
    return (
      <div className="experience-shell">
        <main className="voter-layout">
          <section className="panel mobile-stage">
            <h2>טוענים את המשחק...</h2>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="experience-shell">
      <div className="backdrop-orb orb-one" />
      <div className="backdrop-orb orb-two" />
      <div className="noise-layer" />

      <header className="top-frame">
        <div>
          <p className="eyebrow">משחק יום הולדת אינטרנטי</p>
          <h1>{hostState.eventName}</h1>
          <p className="lead">{hostState.welcomeNote}</p>
          <p className="lead">עדכון אחרון: {updatedAt || 'כרגע'}</p>
          {message ? <p className="lead">{message}</p> : null}
        </div>

        <div className="mode-toggle" role="tablist" aria-label="בחירת מצב">
          <button type="button" className={mode === 'host' ? 'mode-pill active' : 'mode-pill'} onClick={() => setMode('host')}>
            מסך מארח
          </button>
          <button type="button" className={mode === 'voter' ? 'mode-pill active' : 'mode-pill'} onClick={() => setMode('voter')}>
            מסך נייד
          </button>
        </div>
      </header>

      {mode === 'host' ? (
        <main className="host-layout">
          <section className="hero-panel panel">
            <div className="hero-copy">
              <span className="glass-tag">{hostState.eventDate}</span>
              <h2>{hostState.welcomeTitle}</h2>
              <p>יש לך עכשיו שתי דרכים להכניס וידאו: להעלות דרך הממשק, או לשים קבצים קבועים ב־`public/videos` ולהפנות אליהם.</p>
            </div>

            <div className="qr-card">
              <img src={getQrUrl(sessionCode)} alt="QR להצטרפות למשחק" className="qr-image" />
              <div className="qr-meta">
                <strong>קוד משחק: {sessionCode}</strong>
                <p>{getJoinUrl(sessionCode)}</p>
                <button type="button" className="secondary-button" onClick={() => void copyJoinUrl()}>
                  {copied ? 'הקישור הועתק' : 'העתק קישור לניידים'}
                </button>
              </div>
            </div>
          </section>

          <section className="control-grid">
            <article className="panel stat-panel">
              <span>סבב פעיל</span>
              <strong>{currentRound.title}</strong>
            </article>
            <article className="panel stat-panel">
              <span>הצבעה פתוחה</span>
              <strong>{votingRound ? votingRound.title : 'עדיין לא'}</strong>
            </article>
            <article className="panel stat-panel">
              <span>קולות בסבב פתוח</span>
              <strong>{activeRoundVotes}</strong>
            </article>
          </section>

          <section className="rounds-stack">
            {hostState.rounds.map((round, index) => (
              <article className="panel round-panel" key={round.id} style={{ ['--accent' as string]: round.accent }}>
                <div className="round-head">
                  <div>
                    <p className="round-index">Round 0{index + 1}</p>
                    <h3>{round.title}</h3>
                    <p>{round.prompt}</p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      void persistHostState({
                        ...hostState,
                        currentRoundId: round.id,
                        votingRoundId: null,
                      })
                    }
                  >
                    עבור למסך הזה
                  </button>
                </div>

                <div className="round-grid">
                  <div className="video-shell">
                    {round.videoUrl ? (
                      <video className="round-video" controls onEnded={() => void openVoting(round.id)} src={round.videoUrl} />
                    ) : (
                      <div className="video-placeholder">
                        <strong>מקום להעלאת סרטון</strong>
                        <span>אפשר להעלות קובץ מהמחשב או לשייך קובץ קבוע מתיקיית `public/videos`.</span>
                      </div>
                    )}

                    <label className="upload-card">
                      <input type="file" accept="video/*" onChange={(event) => void handleVideoUpload(round.id, event)} />
                      <span>העלה סרטון לסבב</span>
                      <small>{round.videoName || 'עדיין לא נבחר קובץ'}</small>
                    </label>

                    <input
                      className="field"
                      value={round.videoUrl}
                      placeholder="/videos/my-birthday-video.mp4"
                      onChange={(event) =>
                        void updateRound(round.id, (currentRoundState) => ({
                          ...currentRoundState,
                          videoUrl: event.target.value,
                          videoName: event.target.value ? `קובץ קבוע: ${event.target.value}` : '',
                        }))
                      }
                    />
                  </div>

                  <div className="round-side">
                    <div className="choice-editor">
                      {round.choices.map((choice, choiceIndex) => (
                        <input
                          key={`${round.id}-${choiceIndex}`}
                          className="field"
                          value={choice}
                          onChange={(event) =>
                            void updateRound(round.id, (currentRoundState) => ({
                              ...currentRoundState,
                              choices: currentRoundState.choices.map((item, itemIndex) =>
                                itemIndex === choiceIndex ? event.target.value : item,
                              ),
                            }))
                          }
                        />
                      ))}
                    </div>

                    <textarea
                      className="field field-area"
                      value={round.prompt}
                      onChange={(event) => void updateRound(round.id, (currentRoundState) => ({ ...currentRoundState, prompt: event.target.value }))}
                    />

                    <div className="round-actions">
                      <button type="button" className="primary-button" onClick={() => void openVoting(round.id)} disabled={!round.videoUrl}>
                        פתח הצבעה עכשיו
                      </button>
                      <button type="button" className="ghost-button" onClick={() => void clearVotesForRound(round.id)}>
                        אפס את הסבב
                      </button>
                    </div>

                    <div className="round-summary">
                      <span>{hostState.votingRoundId === round.id ? 'ההצבעה פתוחה' : 'ממתין לסיום וידאו או לפתיחה ידנית'}</span>
                      <strong>{hostState.votes.filter((vote) => vote.roundId === round.id).length} הצבעות נשמרו</strong>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {votingRound ? (
            <section className="panel results-panel">
              <div className="round-head">
                <div>
                  <p className="round-index">Live Results</p>
                  <h3>{votingRound.title}</h3>
                  <p>{votingRound.prompt}</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => void closeVoting()}>
                  סגור הצבעה
                </button>
              </div>

              <div className="results-list">
                {leaderboard.map((entry) => (
                  <div className="result-row" key={entry.choice}>
                    <div className="result-line">
                      <span>{entry.choice}</span>
                      <strong>{entry.count}</strong>
                    </div>
                    <div className="result-bar">
                      <div
                        className="result-fill"
                        style={{ width: `${Math.max(8, activeRoundVotes ? (entry.count / activeRoundVotes) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      ) : (
        <main className="voter-layout">
          <section className="panel voter-connect">
            <div>
              <p className="eyebrow">כניסה מהנייד</p>
              <h2>התחברו להצבעה</h2>
              <p>אפשר להיכנס דרך ה־QR או להזין ידנית את קוד המשחק.</p>
            </div>

            <div className="connect-row">
              <input className="field" value={sessionInput} onChange={(event) => setSessionInput(event.target.value.toUpperCase())} placeholder="קוד משחק" />
              <button type="button" className="primary-button" onClick={connectToSession}>
                התחבר
              </button>
            </div>
          </section>

          <section className="panel mobile-stage">
            <span className="glass-tag">{hostState.eventName}</span>
            <h3>{votingRound ? 'ההצבעה פתוחה עכשיו' : 'מחכים שהמארח יפתח את הסבב הבא'}</h3>
            <p>{votingRound ? votingRound.prompt : 'ברגע שהווידאו יסתיים אצל המארח, כאן תופיע ההצבעה.'}</p>

            {votingRound ? (
              <form className="vote-form" onSubmit={(event) => void handleVoteSubmit(event)}>
                <input className="field" value={voterName} onChange={(event) => setVoterName(event.target.value)} placeholder="השם שלכם (אופציונלי)" />

                <div className="mobile-options">
                  {votingRound.choices.map((choice, index) => (
                    <button
                      key={choice}
                      type="button"
                      className={voterChoice === index ? 'vote-card active' : 'vote-card'}
                      onClick={() => setVoterChoice(index)}
                    >
                      <span>{choice}</span>
                    </button>
                  ))}
                </div>

                <button type="submit" className="primary-button" disabled={voterChoice === null}>
                  שלח הצבעה
                </button>
              </form>
            ) : (
              <div className="waiting-card">
                <strong>הסבב עדיין לא פתוח להצבעה.</strong>
                <span>השאירו את המסך פתוח. הוא מתעדכן אוטומטית כל כמה שניות.</span>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
