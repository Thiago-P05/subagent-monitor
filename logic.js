// Done rows leave the default list after this. Errors stay list-eligible until
// history pruning; history mode keeps every terminal row still in memory.
export const RECENT_DONE_MS = 10 * 60 * 1000
const DEFAULT_VISIBLE = 5
const HISTORY_VISIBLE = 12
const NEUTRAL_LABEL = 'subagente'

// Retained terminal rows are memory-only. Pruning must not change totalExecuted.
export const HISTORY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
export const HISTORY_MAX_ROWS = 1500
// A just-created child can be absent from family() for a moment. Do not close it
// on that absence alone until this grace elapses and there is still no running evidence.
export const FALSE_RUNNING_GRACE_MS = 2000

// Known subagents plus the OpenCode build builtin. Agent names stay on this
// allowlist. Task titles are a separate, explicit display field: memory only,
// sanitized, and never written to disk or logs by this module.
// "planner" is not accepted for new sessions. A value already stored as planner
// can still be displayed so hot-reload memory from older builds is not relabeled.
const KNOWN_AGENTS = new Set(['explore', 'builder', 'judge', 'build'])
const LEGACY_STORED_AGENTS = new Set(['planner'])

// Narrow-sidebar budget. The V2 sidebar.content slot does not publish a width,
// so display strings are truncated before paint and the TUI also disables wrap.
export const STORED_TITLE_COLUMNS = 64
export const SIDEBAR_TITLE_COLUMNS = 24
export const SIDEBAR_META_COLUMNS = 24
const CLOCK = '◷'

// Defense in depth: allowlisted names still go through this. Untrusted values are
// rejected by the allowlist before display, so a missed pattern cannot leak.
const SECRET_PATTERNS = [
  /sk-[a-z0-9_-]{8,}/i,
  /\bsk_(?:live|test)_[a-z0-9]+/i,
  /\bpk_(?:live|test)_[a-z0-9]+/i,
  /\brk_(?:live|test)_[a-z0-9]+/i,
  /\bbearer\s+[a-z0-9._\-]+/i,
  /-----begin /i,
  /\bxox[baprs]-/i,
  /\bxoxe-/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[a-z0-9_]{8,}/i,
  /\bgithub_pat_[a-z0-9_]{8,}/i,
  /\bglpat-[a-z0-9_\-]{8,}/i,
  /\bakia[0-9a-z]{16}/i,
  /\baiza[0-9a-z_-]{20,}/i,
  // xAIza… has no word boundary before "aiza"; the optional x keeps that prefix out of memory.
  /x?aiza[0-9a-z_-]{12,}/i,
  /\bnpm_[a-z0-9]{20,}/i,
  /\bhf_[a-z0-9]{20,}/i,
  /\bxai-[a-z0-9]{8,}/i,
  /\bpypi-[a-z0-9_\-]{8,}/i,
  /\beyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\./i,
]

export function containsSecret(value) {
  const text = String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (!text) return false
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const STATUS = {
  running: 'running',
  done: 'done',
  error: 'error',
}

export function createEmptyState() {
  return { children: {}, counted: {}, totalExecuted: 0, now: 0 }
}

export function isPromptLike(value) {
  const text = String(value ?? '').trim()
  if (!text) return false
  return text.length > 48 || text.split(/\s+/).length > 8
}

export function sanitizeAgent(value) {
  const text = normalizeText(value)
  if (!text) return undefined
  const agent = text.toLowerCase()
  if (!KNOWN_AGENTS.has(agent)) return undefined
  if (containsSecret(agent)) return undefined
  return agent
}

export function sanitizeLabel(value, fallback = NEUTRAL_LABEL) {
  return sanitizeAgent(value) ?? fallback
}

function columnWidthOf(codePoint) {
  if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  if (codePoint === 0x200d || (codePoint >= 0x0300 && codePoint <= 0x036f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) {
    return 0
  }
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f6ff)
  ) {
    return 2
  }
  return 1
}

export function columnWidth(value) {
  let width = 0
  for (const character of String(value ?? '')) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue
    width += columnWidthOf(codePoint)
  }
  return width
}

function takeColumns(value, maxColumns) {
  if (maxColumns <= 0) return ''
  let width = 0
  let result = ''
  for (const character of String(value ?? '')) {
    const codePoint = character.codePointAt(0) ?? 0
    const next = columnWidthOf(codePoint)
    if (width + next > maxColumns) break
    width += next
    result += character
  }
  return result
}

export function truncateColumns(value, maxColumns) {
  const text = String(value ?? '')
  const limit = Number(maxColumns)
  if (!Number.isFinite(limit) || limit <= 0) return ''
  if (columnWidth(text) <= limit) return text
  const ellipsis = '…'
  const budget = limit - columnWidth(ellipsis)
  if (budget <= 0) return ellipsis
  return `${takeColumns(text, budget).trimEnd()}${ellipsis}`
}

function stripControls(value) {
  return String(value ?? '')
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
}

function redactSecrets(value) {
  let next = String(value ?? '')
  for (const pattern of SECRET_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    next = next.replace(new RegExp(pattern.source, flags), ' ')
  }
  next = next.replace(
    /(?:^|\s)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/gi,
    ' ',
  )
  return next
}

function usefulTitle(value) {
  return /[\p{L}\p{N}]{2,}/u.test(String(value ?? ''))
}

// Memory-only display title. Callers must not log or persist the result.
// Sources are limited to verified V2 strings: SessionInfo.title,
// session.created data.title, and session.renamed data.title.
export function sanitizeTitle(value, maxColumns = STORED_TITLE_COLUMNS) {
  if (typeof value !== 'string') return undefined
  const cleaned = normalizeText(redactSecrets(stripControls(value.slice(0, 500))))
  if (!cleaned || !usefulTitle(cleaned) || containsSecret(cleaned)) return undefined
  const truncated = truncateColumns(cleaned, maxColumns).trim()
  if (!truncated || !usefulTitle(truncated) || containsSecret(truncated)) return undefined
  return truncated
}

export function uiLocale() {
  const env = process.env.LC_ALL || process.env.LANG || process.env.LANGUAGE || ''
  const lang = String(env || Intl.DateTimeFormat().resolvedOptions().locale || 'es').toLowerCase()
  return lang.startsWith('en') ? 'en' : 'es'
}

export function sectionHeading(locale = uiLocale()) {
  return locale === 'en' ? 'Subagents' : 'Subagentes'
}

export function emptyLabel(locale = uiLocale()) {
  return locale === 'en' ? 'no subagents' : 'sin subagentes'
}

function storedAgent(value) {
  const agent = normalizeText(value).toLowerCase()
  if (!agent || containsSecret(agent)) return undefined
  if (KNOWN_AGENTS.has(agent) || LEGACY_STORED_AGENTS.has(agent)) return agent
  return undefined
}

// Renders an agent already stored on an in-memory row, including legacy planner.
export function displayStoredName(value) {
  return storedAgent(value) ?? NEUTRAL_LABEL
}

export function displayName(child) {
  return sanitizeAgent(child?.agent) ?? NEUTRAL_LABEL
}

function rowLabel(session, overlayChild) {
  return sanitizeAgent(session?.agent) ?? displayStoredName(overlayChild?.agent)
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

export function tokenTotal(tokens) {
  if (!tokens || typeof tokens !== 'object') return 0
  const input = Number(tokens.input) || 0
  const output = Number(tokens.output) || 0
  const reasoning = Number(tokens.reasoning) || 0
  return input + output + reasoning
}

export function formatTokens(tokens) {
  const total = tokenTotal(tokens)
  if (!total) return ''
  if (total >= 1000) {
    const value = total / 1000
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}k`
  }
  return String(total)
}

export function numericTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return undefined
  const input = Number(tokens.input)
  const output = Number(tokens.output)
  const reasoning = Number(tokens.reasoning)
  if (![input, output, reasoning].some((value) => Number.isFinite(value) && value > 0)) return undefined
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    reasoning: Number.isFinite(reasoning) ? reasoning : 0,
  }
}

export function classifyStatus(input) {
  const overlay = input?.overlayStatus
  const live = input?.liveStatus
  const outcome = input?.outcome
  if (overlay === STATUS.error || outcome === 'failed') return STATUS.error
  if (live === 'running') return STATUS.running
  if (outcome === 'interrupted') return STATUS.error
  if (outcome === 'succeeded' || live === 'idle' || overlay === STATUS.done) return STATUS.done
  if (overlay === STATUS.running) return STATUS.running
  return STATUS.running
}

// Documented V2 status() is "idle" | "running". session.status events also use
// busy/idle/retry. Anything else is ignored rather than invented.
export function normalizeLiveStatus(value) {
  const type = value && typeof value === 'object' ? value.type : value
  if (type === 'running' || type === 'busy' || type === 'retry') return 'running'
  if (type === 'idle') return 'idle'
  return undefined
}

function eventData(event) {
  return event?.data && typeof event.data === 'object' ? event.data : {}
}

function eventTime(event) {
  const created = Number(event?.created)
  return Number.isFinite(created) && created > 0 ? created : Date.now()
}

function ensureTotals(state) {
  if (!state.counted || typeof state.counted !== 'object') state.counted = {}
  if (!Number.isFinite(state.totalExecuted) || state.totalExecuted < 0) state.totalExecuted = 0
}

export function noteExecution(state, id) {
  if (!state || !id || typeof id !== 'string') return false
  ensureTotals(state)
  if (state.counted[id]) return false
  state.counted[id] = true
  state.totalExecuted += 1
  return true
}

function scrubChild(child) {
  if (!child || typeof child !== 'object') return
  const title = sanitizeTitle(child.title)
  if (title) child.title = title
  else delete child.title
  delete child.summary
  delete child.prompt
  delete child.text
  delete child.message
  delete child.error
  delete child.metadata
  delete child.instructions
  const agent = storedAgent(child.agent)
  if (agent) child.agent = agent
  else delete child.agent
  if (child.tokens) {
    const tokens = numericTokens(child.tokens)
    if (tokens) child.tokens = tokens
    else delete child.tokens
  }
}

function upsertChild(state, id, patch) {
  if (!id || typeof id !== 'string') return false
  const existed = Object.prototype.hasOwnProperty.call(state.children, id)
  const current = state.children[id] ?? { id, status: STATUS.running }
  const next = { ...current, ...patch, id }
  delete next.summary
  delete next.prompt
  delete next.text
  delete next.message
  delete next.error
  delete next.metadata
  delete next.instructions
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    const title = sanitizeTitle(patch.title)
    if (title) next.title = title
    else delete next.title
  } else {
    const title = sanitizeTitle(current.title)
    if (title) next.title = title
    else delete next.title
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'agent')) {
    const agent = sanitizeAgent(patch.agent)
    if (agent) next.agent = agent
    else if (storedAgent(current.agent)) next.agent = storedAgent(current.agent)
    else delete next.agent
  }
  scrubChild(next)
  state.children[id] = next
  if (!existed || !state.counted?.[id]) noteExecution(state, id)
  return true
}

function eventSessionID(data) {
  return typeof data.sessionID === 'string' ? data.sessionID : undefined
}

export function applySessionEvent(state, event) {
  if (!state?.children || !event || typeof event.type !== 'string') return false
  const data = eventData(event)
  const sessionID = eventSessionID(data)
  const at = eventTime(event)

  // V2 title contract (client SessionCreated / SessionRenamed / SessionInfo):
  // data.title only. session.forked has no title. event.metadata and
  // data.metadata are untyped bags and are never read.
  if (event.type === 'session.renamed') {
    if (!sessionID || !state.children[sessionID] || typeof data.title !== 'string') return false
    return upsertChild(state, sessionID, { title: data.title, updatedAt: at })
  }

  if (event.type === 'session.created' || event.type === 'session.forked') {
    const parentID = typeof data.parentID === 'string' ? data.parentID : undefined
    if (!sessionID || !parentID) return false
    const patch = {
      parentID,
      status: STATUS.running,
      startedAt: state.children[sessionID]?.startedAt ?? at,
      updatedAt: at,
      agent: data.agent,
    }
    if (event.type === 'session.created' && typeof data.title === 'string') patch.title = data.title
    return upsertChild(state, sessionID, patch)
  }

  if (!sessionID || !state.children[sessionID]) return false

  if (event.type === 'session.deleted') {
    delete state.children[sessionID]
    return true
  }

  if (
    event.type === 'session.execution.started' ||
    (event.type === 'session.status' && (data.status?.type === 'busy' || data.status?.type === 'retry'))
  ) {
    return upsertChild(state, sessionID, { status: STATUS.running, updatedAt: at })
  }

  if (event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') {
    return upsertChild(state, sessionID, { status: STATUS.error, endedAt: at, updatedAt: at })
  }

  if (
    event.type === 'session.execution.succeeded' ||
    event.type === 'session.idle' ||
    (event.type === 'session.status' && data.status?.type === 'idle')
  ) {
    const current = state.children[sessionID]
    if (current.status === STATUS.error) {
      return upsertChild(state, sessionID, { updatedAt: at })
    }
    return upsertChild(state, sessionID, { status: STATUS.done, endedAt: current.endedAt ?? at, updatedAt: at })
  }

  return false
}

export function liveSessionsForParent(sessions, parentID) {
  if (!parentID || !Array.isArray(sessions)) return []
  return sessions.filter((session) => session && session.parentID === parentID && typeof session.id === 'string')
}

function startedAtOf(child, session) {
  return child.startedAt || session?.time?.created || child.updatedAt || 0
}

function endedAtOf(child, session) {
  return child.endedAt || session?.time?.idle || session?.time?.updated || 0
}

function statusFromEvidence(session, liveStatus, overlayStatus) {
  const live = normalizeLiveStatus(liveStatus)
  if (live === 'running') return STATUS.running
  if (overlayStatus === STATUS.error || session?.outcome === 'failed' || session?.outcome === 'interrupted') {
    return STATUS.error
  }
  if (session?.outcome === 'succeeded' || live === 'idle' || session?.time?.idle) return STATUS.done
  if (overlayStatus === STATUS.done || overlayStatus === STATUS.running) return overlayStatus
  return STATUS.running
}

function pickSession(session) {
  if (!session || typeof session.id !== 'string') return undefined
  const picked = {
    id: session.id,
    parentID: typeof session.parentID === 'string' ? session.parentID : undefined,
    agent: session.agent,
    outcome: session.outcome,
  }
  if (session.time && typeof session.time === 'object') {
    picked.time = {
      created: Number(session.time.created) || undefined,
      updated: Number(session.time.updated) || undefined,
      idle: Number(session.time.idle) || undefined,
    }
  }
  const tokens = numericTokens(session.tokens)
  if (tokens) picked.tokens = tokens
  // SessionInfo.title is the only session-object title in the V2 contract.
  if (typeof session.title === 'string') {
    const title = sanitizeTitle(session.title)
    if (title) picked.title = title
  }
  return picked
}

function safeCall(fn) {
  try {
    return fn()
  } catch {
    return undefined
  }
}

export function readSessionSnapshot(sessionApi, parentID, now = Date.now()) {
  const list = safeCall(() => sessionApi?.list?.()) ?? []
  const family = safeCall(() => sessionApi?.family?.(parentID))
  const familyIDs = Array.isArray(family) ? family.filter((id) => typeof id === 'string') : undefined
  const ids = new Set()
  for (const session of Array.isArray(list) ? list : []) {
    if (session?.parentID === parentID && typeof session.id === 'string') ids.add(session.id)
  }
  if (familyIDs) {
    for (const id of familyIDs) {
      if (id && id !== parentID) ids.add(id)
    }
  }

  const sessions = []
  const statusById = {}
  for (const id of ids) {
    const info = safeCall(() => sessionApi?.get?.(id)) ?? (Array.isArray(list) ? list.find((session) => session?.id === id) : undefined)
    const picked = pickSession(info)
    if (picked?.parentID === parentID) sessions.push(picked)
    const live = normalizeLiveStatus(safeCall(() => sessionApi?.status?.(id)))
    if (live) statusById[id] = live
  }

  return {
    parentID,
    sessions,
    statusById,
    familyIDs,
    authoritative: Array.isArray(familyIDs),
    hydrated: true,
    now,
  }
}

export function reconcileParent(state, input) {
  if (!state?.children || !input?.parentID) return false
  const parentID = input.parentID
  const now = Number(input.now) || Date.now()
  const sessions = liveSessionsForParent(input.sessions, parentID).map((session) => pickSession(session)).filter(Boolean)
  const statusById = input.statusById ?? {}
  const familyIDs = Array.isArray(input.familyIDs) ? input.familyIDs : undefined
  const familySet = familyIDs ? new Set(familyIDs) : undefined
  let changed = false

  for (const session of sessions) {
    const current = state.children[session.id]
    const live = statusById[session.id]
    const status = statusFromEvidence(session, live, current?.status)
    const startedAt = session.time?.created || current?.startedAt || now
    const patch = {
      parentID,
      status,
      startedAt,
      updatedAt: session.time?.updated || now,
    }
    if (status !== STATUS.running) patch.endedAt = session.time?.idle || current?.endedAt || session.time?.updated || now
    if (sanitizeAgent(session.agent)) patch.agent = session.agent
    if (session.tokens) patch.tokens = session.tokens
    if (typeof session.title === 'string') patch.title = session.title
    if (upsertChild(state, session.id, patch)) changed = true
  }

  if (input.hydrated === true) {
    for (const child of Object.values(state.children)) {
      if (!child || child.parentID !== parentID || child.status !== STATUS.running) continue
      const live = normalizeLiveStatus(statusById[child.id])
      const session = sessions.find((item) => item.id === child.id)
      if (live === 'running') continue
      if (live === 'idle' || session?.outcome || session?.time?.idle) {
        const status = statusFromEvidence(session, live ?? 'idle', child.status)
        upsertChild(state, child.id, {
          status,
          endedAt: session?.time?.idle || child.endedAt || now,
          updatedAt: now,
        })
        changed = true
        continue
      }
      if (input.authoritative === true && familySet && !familySet.has(child.id) && !session) {
        const age = now - (child.startedAt || child.updatedAt || now)
        if (age >= FALSE_RUNNING_GRACE_MS) {
          upsertChild(state, child.id, { status: STATUS.done, endedAt: now, updatedAt: now })
          changed = true
        }
      }
    }
  }

  if (pruneHistory(state, now)) changed = true
  return changed
}

export function pruneHistory(state, now = Date.now()) {
  if (!state?.children) return false
  const before = state.totalExecuted
  let changed = false
  const terminal = []
  for (const child of Object.values(state.children)) {
    if (!child?.id) continue
    scrubChild(child)
    if (child.status === STATUS.running) continue
    const ended = child.endedAt || child.updatedAt || 0
    if (ended && now - ended > HISTORY_MAX_AGE_MS) {
      delete state.children[child.id]
      changed = true
      continue
    }
    terminal.push(child)
  }
  if (terminal.length > HISTORY_MAX_ROWS) {
    terminal.sort((a, b) => (a.endedAt || a.updatedAt || 0) - (b.endedAt || b.updatedAt || 0))
    for (const child of terminal.slice(0, terminal.length - HISTORY_MAX_ROWS)) {
      delete state.children[child.id]
      changed = true
    }
  }
  if (state.totalExecuted !== before) state.totalExecuted = before
  return changed
}

function compareStatusRows(a, b) {
  const rank = { running: 0, error: 1, done: 2 }
  const diff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
  if (diff !== 0) return diff
  return (b.startedAt || 0) - (a.startedAt || 0)
}

// Same parent, window, and history rules as the sidebar list. Display caps are
// applied later so a count can see every relevant child without formatting titles.
function prepareRows(input) {
  const parentID = input?.parentID
  const now = Number(input?.now) || Date.now()
  const showHistory = input?.showHistory === true
  const overlay = input?.overlay?.children ?? {}
  const live = liveSessionsForParent(input?.sessions, parentID)
  const statusById = input?.statusById ?? {}
  const rows = new Map()

  for (const [id, child] of Object.entries(overlay)) {
    if (!child || child.parentID !== parentID) continue
    rows.set(id, { id, overlay: child, session: undefined })
  }

  for (const session of live) {
    const current = rows.get(session.id) ?? { id: session.id, overlay: { id: session.id, parentID, status: STATUS.running } }
    current.session = session
    if (!current.overlay.parentID) current.overlay.parentID = parentID
    rows.set(session.id, current)
  }

  const list = []
  for (const row of rows.values()) {
    const overlayChild = row.overlay
    const session = row.session
    const status = classifyStatus({
      overlayStatus: overlayChild.status,
      liveStatus: statusById[row.id] ?? (session ? undefined : overlayChild.status === STATUS.running ? 'running' : 'idle'),
      outcome: session?.outcome,
    })
    const startedAt = startedAtOf(overlayChild, session)
    const endedAt = status === STATUS.running ? undefined : endedAtOf(overlayChild, session)
    list.push({
      id: row.id,
      parentID,
      overlay: overlayChild,
      session,
      status,
      startedAt,
      endedAt,
    })
  }

  list.sort(compareStatusRows)
  const relevant = list.filter((row) => {
    if (row.status === STATUS.running || row.status === STATUS.error) return true
    if (showHistory) return true
    if (!row.endedAt) return false
    return now - row.endedAt <= RECENT_DONE_MS
  })
  return { parentID, now, showHistory, rows: relevant }
}

function toDisplayRow(row, now, parentID) {
  const overlayChild = row.overlay
  const session = row.session
  const endedAt = row.status === STATUS.running ? now : endedAtOf(overlayChild, session)
  const elapsedMs = Math.max(0, (endedAt || now) - (row.startedAt || now))
  const label = rowLabel(session, overlayChild)
  const titled = session && typeof session.title === 'string' ? sanitizeTitle(session.title) : sanitizeTitle(overlayChild?.title)
  return {
    id: row.id,
    parentID,
    status: row.status,
    label,
    title: titled ?? label,
    elapsed: formatDuration(elapsedMs),
    elapsedMs,
    tokens: formatTokens(session?.tokens || overlayChild.tokens),
    startedAt: row.startedAt,
    endedAt: row.status === STATUS.running ? undefined : endedAt,
  }
}

export function collectRows(input) {
  const prepared = prepareRows(input)
  const limit = prepared.showHistory ? HISTORY_VISIBLE : DEFAULT_VISIBLE
  // Format only the capped list. Navigation and paint must not walk every child.
  return prepared.rows.slice(0, limit).map((row) => toDisplayRow(row, prepared.now, prepared.parentID))
}

// Header/summary counts. Same relevant set as collectRows, without the 5/12 cap.
export function countRelevantRows(input) {
  if (!input?.parentID) return countRows([])
  return countRows(prepareRows(input).rows)
}

export function countRows(rows) {
  const counts = { running: 0, done: 0, error: 0, total: 0 }
  for (const row of rows ?? []) {
    counts.total += 1
    if (row.status === STATUS.running) counts.running += 1
    else if (row.status === STATUS.error) counts.error += 1
    else counts.done += 1
  }
  return counts
}

export function formatCounts(counts) {
  const value = counts ?? countRows([])
  return `●${value.running} · ✓${value.done} · ✕${value.error}`
}

export function formatHeader(counts, totalExecuted) {
  const base = formatCounts(counts)
  const total = Number(totalExecuted)
  if (!Number.isFinite(total) || total <= 0) return base
  return `${base} · Σ${total}`
}

export function statusGlyph(status) {
  if (status === STATUS.running) return '●'
  if (status === STATUS.error) return '✕'
  return '✓'
}

function summaryWord(locale, status, count) {
  if (locale === 'en') {
    if (status === 'running') return 'running'
    if (status === 'error') return 'error'
    return 'done'
  }
  if (status === 'running') return 'en curso'
  if (status === 'error') return count === 1 ? 'error' : 'errores'
  return count === 1 ? 'listo' : 'listos'
}

export function summaryParts(counts, locale = uiLocale()) {
  const value = counts ?? { running: 0, done: 0, error: 0 }
  const lang = locale === 'en' ? 'en' : 'es'
  return [
    { status: 'running', glyph: '•', count: Number(value.running) || 0 },
    { status: 'done', glyph: '✓', count: Number(value.done) || 0 },
    { status: 'error', glyph: '✕', count: Number(value.error) || 0 },
  ].map((part) => ({
    ...part,
    text: `${part.count} ${summaryWord(lang, part.status, part.count)}`,
  }))
}

export function formatSummary(counts, locale = uiLocale()) {
  return summaryParts(counts, locale)
    .map((part) => `${part.glyph} ${part.text}`)
    .join(' · ')
}

export function formatMeta(row, maxColumns = SIDEBAR_META_COLUMNS) {
  const agent = displayStoredName(row?.label)
  const parts = [agent]
  if (row?.elapsed) parts.push(String(row.elapsed))
  if (row?.tokens) parts.push(String(row.tokens))
  return truncateColumns(`${CLOCK} ${parts.join(' · ')}`, maxColumns)
}

export function renderSidebarLines(input = {}) {
  const locale = input.locale === 'en' ? 'en' : input.locale === 'es' ? 'es' : uiLocale()
  const width = Number(input.width) > 0 ? Number(input.width) : SIDEBAR_TITLE_COLUMNS
  const expanded = input.expanded !== false
  const lines = [`${expanded ? '▼' : '▶'} ${sectionHeading(locale)}`]
  if (!expanded) return lines
  // The designed summary is one line. Cap it so a huge count cannot wrap, but
  // keep the readable "• N running · …" form above the narrow title budget.
  lines.push(truncateColumns(formatSummary(input.counts, locale), Math.max(width, 48)))
  const rows = Array.isArray(input.rows) ? input.rows : []
  if (rows.length === 0) {
    lines.push(`  ${emptyLabel(locale)}`)
    return lines
  }
  for (const row of rows) {
    const selected = input.focused === true && input.selectedID && input.selectedID === row.id
    const lead = selected ? '›' : ' '
    const title = truncateColumns(row?.title || row?.label || NEUTRAL_LABEL, width)
    lines.push(`${lead}${statusGlyph(row?.status)} ${title}`)
    lines.push(`   ${formatMeta(row, width)}`)
  }
  return lines
}

export function footerVisible(counts) {
  return Boolean(counts && (counts.running > 0 || counts.error > 0 || counts.total > 0))
}

export function homeFooterCounts(overlay) {
  return countRows(Object.values(overlay?.children ?? {}).map((child) => ({ status: child?.status })))
}
