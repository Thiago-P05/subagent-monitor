import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALSE_RUNNING_GRACE_MS,
  HISTORY_MAX_AGE_MS,
  HISTORY_MAX_ROWS,
  applySessionEvent,
  classifyStatus,
  collectRows,
  containsSecret,
  countRelevantRows,
  countRows,
  createEmptyState,
  displayName,
  displayStoredName,
  footerVisible,
  formatCounts,
  formatDuration,
  formatHeader,
  formatTokens,
  homeFooterCounts,
  isPromptLike,
  noteExecution,
  pruneHistory,
  RECENT_DONE_MS,
  readSessionSnapshot,
  reconcileParent,
  sanitizeAgent,
  sanitizeLabel,
  sanitizeTitle,
  statusGlyph,
} from './logic.js'

test('sanitizeLabel strips secret-like fragments', () => {
  assert.equal(sanitizeLabel('sk-abcdefghijklmnop'), 'subagente')
  assert.equal(sanitizeLabel('Authorization Bearer abc.def-ghi'), 'subagente')
  assert.equal(sanitizeLabel('OPENAI_API_KEY=secret-value builder'), 'subagente')
  assert.equal(sanitizeLabel('planner'), 'subagente')
})

test('sanitizeAgent allowlists only known subagents and builtins', () => {
  assert.equal(sanitizeAgent('explore'), 'explore')
  assert.equal(sanitizeAgent('planner'), undefined)
  assert.equal(sanitizeAgent('builder'), 'builder')
  assert.equal(sanitizeAgent('judge'), 'judge')
  assert.equal(sanitizeAgent('build'), 'build')
  assert.equal(sanitizeAgent('  Judge  '), 'judge')
  assert.equal(sanitizeAgent('Explore'), 'explore')
  assert.equal(sanitizeAgent('reviewer'), undefined)
  assert.equal(sanitizeAgent('orchestrator'), undefined)
  assert.equal(sanitizeAgent('not a valid agent name'), undefined)
  assert.equal(sanitizeLabel('reviewer'), 'subagente')
  assert.equal(sanitizeLabel('Fix login'), 'subagente')
  assert.equal(sanitizeLabel('builder task with spaces'), 'subagente')
  assert.equal(sanitizeLabel('build'), 'build')
})

test('adversarial titles and agents never leak frequent credentials', () => {
  const samples = [
    'ghp_TESTTOKEN0000000000000000000000000000',
    'gho_TESTTOKEN0000000000000000000000000000',
    'ghu_TESTTOKEN0000000000000000000000000000',
    'ghs_TESTTOKEN0000000000000000000000000000',
    'ghr_TESTTOKEN0000000000000000000000000000',
    'github_pat_TESTTOKEN00000000000000000000',
    'glpat-TESTTOKEN0000000000000000',
    'xoxb-1234567890-abcdefgh',
    'sk-ant-api03-TESTTOKEN',
    'sk-abcdefghijklmnopqrstuvwxyz',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyA-testtoken-abcdefghijklmnopqrst',
    'npm_abcdefghijklmnopqrstuvwxyz0123456789',
    'hf_abcdefghijklmnopqrstuvwxyz0123456789',
    'xai-TESTTOKEN00000000000000000000',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature',
    '-----BEGIN PRIVATE KEY-----',
    'Authorization Bearer abc.def-ghi',
    `ghp_\u200bTESTTOKEN0000000000000000000000`,
    'reviewer ghp_TESTTOKEN0000000000000000000000',
  ]
  for (const sample of samples) {
    assert.equal(containsSecret(sample), true, sample)
    assert.equal(sanitizeLabel(sample), 'subagente', sample)
    assert.equal(sanitizeAgent(sample), undefined, sample)
    assert.equal(displayName({ title: sample }), 'subagente', sample)
    assert.equal(displayName({ agent: sample }), 'subagente', sample)
  }
})

test('displayName uses allowlisted agent only and ignores titles', () => {
  assert.equal(displayName({ agent: 'builder', title: 'sk-abcdefghijklmnop' }), 'builder')
  assert.equal(displayName({ agent: 'builder', title: 'ghp_TESTTOKEN0000000000000000000000' }), 'builder')
  assert.equal(
    displayName({ title: 'Implementá el monitor de subagentes en el sidebar con mucho detalle extra' }),
    'subagente',
  )
  assert.equal(displayName({ title: 'reviewer' }), 'subagente')
  assert.equal(displayName({ title: 'planner' }), 'subagente')
  assert.equal(displayName({ agent: 'reviewer', title: 'builder' }), 'subagente')
})

const XAIZA_KEY = 'xAIzaSyA-testtoken-abcdefghijklmnopqrst'
const XAIZA_KEY_40 = 'xAIzaSyA-testtoken-abcdefghijklmnopqrstu'
const AIZA_KEY = 'AIzaSyA-testtoken-abcdefghijklmnopqrst'

test('xAIza and identifier-shaped keys never render or store', () => {
  const samples = [
    XAIZA_KEY,
    XAIZA_KEY_40,
    AIZA_KEY,
    `x${AIZA_KEY}`,
    `q${AIZA_KEY}`,
    `builder${XAIZA_KEY}`,
    `${XAIZA_KEY}builder`,
    `explore ${XAIZA_KEY}`,
    `${XAIZA_KEY} explore`,
    `x\u200bAIzaSyA-testtoken-abcdefghijklmnopqrst`,
    `builder ${XAIZA_KEY}`,
    'reviewer',
  ]
  for (const sample of samples) {
    assert.equal(sanitizeAgent(sample), undefined, sample)
    assert.equal(sanitizeLabel(sample), 'subagente', sample)
    assert.equal(displayName({ agent: sample }), 'subagente', sample)
    assert.equal(displayName({ title: sample }), 'subagente', sample)
    assert.equal(displayName({ agent: sample, title: 'builder' }), 'subagente', sample)
    assert.equal(displayName({ agent: 'builder', title: sample }), 'builder', sample)
  }

  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 1,
    data: {
      sessionID: 'ses_xaiza',
      parentID: 'ses_root',
      agent: XAIZA_KEY,
      title: XAIZA_KEY,
    },
  })
  assert.equal(state.children.ses_xaiza.agent, undefined)
  assert.equal(state.children.ses_xaiza.title, undefined)
  assert.equal(JSON.stringify(state.children.ses_xaiza).includes('AIza'), false)
  assert.equal(JSON.stringify(state.children.ses_xaiza).includes('xAI'), false)
  assert.equal(displayName(state.children.ses_xaiza), 'subagente')

  applySessionEvent(state, {
    type: 'session.renamed',
    created: 2,
    data: { sessionID: 'ses_xaiza', title: XAIZA_KEY },
  })
  assert.equal(state.children.ses_xaiza.title, undefined)
  assert.equal(JSON.stringify(state.children.ses_xaiza).includes('AIza'), false)

  const rows = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [
      {
        id: 'ses_live',
        parentID: 'ses_root',
        agent: XAIZA_KEY,
        time: { created: 1 },
      },
    ],
    statusById: { ses_live: 'running', ses_xaiza: 'running' },
    now: 50_000,
    showHistory: false,
  })
  assert.ok(rows.length >= 1)
  for (const row of rows) {
    assert.equal(row.label, 'subagente')
    assert.equal(JSON.stringify(row).includes('AIza'), false)
    assert.equal(JSON.stringify(row).includes(XAIZA_KEY), false)
  }
})

test('isPromptLike detects long task text', () => {
  assert.equal(isPromptLike('builder'), false)
  assert.equal(isPromptLike('one two three four five six seven eight nine'), true)
})

test('formatDuration and tokens stay compact', () => {
  assert.equal(formatDuration(1500), '1s')
  assert.equal(formatDuration(125000), '2m 05s')
  assert.equal(formatDuration(3723000), '1h 02m')
  assert.equal(formatTokens({ input: 200, output: 50, reasoning: 0 }), '250')
  assert.equal(formatTokens({ input: 1200, output: 300, reasoning: 0 }), '1.5k')
})

test('classifyStatus maps live, overlay and outcome', () => {
  assert.equal(classifyStatus({ liveStatus: 'running' }), 'running')
  assert.equal(classifyStatus({ overlayStatus: 'error' }), 'error')
  assert.equal(classifyStatus({ outcome: 'failed', liveStatus: 'idle' }), 'error')
  assert.equal(classifyStatus({ outcome: 'succeeded', liveStatus: 'idle' }), 'done')
  assert.equal(classifyStatus({ overlayStatus: 'running', liveStatus: 'idle', outcome: 'succeeded' }), 'done')
})

test('session.created starts a child and execution events end it', () => {
  const state = createEmptyState()
  assert.equal(
    applySessionEvent(state, {
      type: 'session.created',
      created: 1000,
      data: { sessionID: 'ses_child', parentID: 'ses_root', agent: 'builder', title: 'builder' },
    }),
    true,
  )
  assert.equal(state.children.ses_child.status, 'running')
  assert.equal(state.children.ses_child.parentID, 'ses_root')

  assert.equal(
    applySessionEvent(state, {
      type: 'session.execution.succeeded',
      created: 4000,
      data: { sessionID: 'ses_child' },
    }),
    true,
  )
  assert.equal(state.children.ses_child.status, 'done')
  assert.equal(state.children.ses_child.endedAt, 4000)

  const failed = createEmptyState()
  applySessionEvent(failed, {
    type: 'session.created',
    created: 1,
    data: { sessionID: 'ses_x', parentID: 'ses_root', agent: 'judge' },
  })
  applySessionEvent(failed, {
    type: 'session.execution.failed',
    created: 2,
    data: { sessionID: 'ses_x', error: { message: 'sk-should-not-be-stored' } },
  })
  assert.equal(failed.children.ses_x.status, 'error')
  assert.equal(JSON.stringify(failed.children.ses_x).includes('sk-should-not-be-stored'), false)
})

test('root sessions are ignored and deleted children disappear', () => {
  const state = createEmptyState()
  assert.equal(
    applySessionEvent(state, {
      type: 'session.created',
      data: { sessionID: 'ses_root', title: 'main' },
    }),
    false,
  )
  applySessionEvent(state, {
    type: 'session.created',
    data: { sessionID: 'ses_child', parentID: 'ses_root', agent: 'planner' },
  })
  applySessionEvent(state, { type: 'session.deleted', data: { sessionID: 'ses_child' } })
  assert.equal(state.children.ses_child, undefined)
})

test('collectRows scopes to the current parent and hides stale done rows', () => {
  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 1,
    data: { sessionID: 'ses_a', parentID: 'ses_root', agent: 'builder' },
  })
  applySessionEvent(state, {
    type: 'session.created',
    created: 2,
    data: { sessionID: 'ses_b', parentID: 'ses_other', agent: 'judge' },
  })
  applySessionEvent(state, {
    type: 'session.execution.succeeded',
    created: 3,
    data: { sessionID: 'ses_a' },
  })

  const now = 3 + 11 * 60 * 1000
  const hidden = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [],
    now,
    showHistory: false,
  })
  assert.equal(hidden.length, 0)

  const shown = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [{ id: 'ses_a', parentID: 'ses_root', agent: 'builder', outcome: 'succeeded', time: { created: 1 } }],
    statusById: { ses_a: 'idle' },
    now: 50_000,
    showHistory: false,
  })
  assert.equal(shown.length, 1)
  assert.equal(shown[0].label, 'builder')
  assert.equal(shown[0].status, 'done')
  assert.equal(shown[0].parentID, 'ses_root')
})

test('countRelevantRows uses the parent window and ignores the display cap', () => {
  const now = Date.now()
  const state = createEmptyState()
  const specs = [
    { id: 'ses_edge', status: 'done', endedAt: now - RECENT_DONE_MS, parentID: 'ses_root' },
    { id: 'ses_old', status: 'done', endedAt: now - RECENT_DONE_MS - 1, parentID: 'ses_root' },
    { id: 'ses_old_error', status: 'error', endedAt: now - RECENT_DONE_MS - 1, parentID: 'ses_root' },
    { id: 'ses_foreign', status: 'done', endedAt: now - 1_000, parentID: 'ses_other' },
  ]
  for (const spec of specs) {
    applySessionEvent(state, {
      type: 'session.created',
      created: spec.endedAt - 1_000,
      data: { sessionID: spec.id, parentID: spec.parentID, agent: 'builder' },
    })
    applySessionEvent(state, {
      type: spec.status === 'error' ? 'session.execution.failed' : 'session.execution.succeeded',
      created: spec.endedAt,
      data: { sessionID: spec.id },
    })
  }

  const recent = countRelevantRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [],
    now,
    showHistory: false,
  })
  assert.deepEqual(recent, { running: 0, done: 1, error: 1, total: 2 })
  assert.equal(
    collectRows({ parentID: 'ses_root', overlay: state, sessions: [], now, showHistory: false }).some(
      (row) => row.id === 'ses_old' || row.id === 'ses_foreign',
    ),
    false,
  )

  const history = countRelevantRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [],
    now,
    showHistory: true,
  })
  assert.deepEqual(history, { running: 0, done: 2, error: 1, total: 3 })
  assert.deepEqual(countRelevantRows({ overlay: state, now }), { running: 0, done: 0, error: 0, total: 0 })
})

test('counts and footer match the sidebar contract', () => {
  const counts = countRows([
    { status: 'running' },
    { status: 'done' },
    { status: 'done' },
    { status: 'error' },
  ])
  assert.deepEqual(counts, { running: 1, done: 2, error: 1, total: 4 })
  assert.equal(formatCounts(counts), '●1 · ✓2 · ✕1')
  assert.equal(footerVisible(counts), true)
  assert.equal(footerVisible({ running: 0, done: 0, error: 0, total: 0 }), false)
  assert.equal(statusGlyph('running'), '●')
  assert.equal(statusGlyph('done'), '✓')
  assert.equal(statusGlyph('error'), '✕')
})

test('home footer helper tracks overlay snapshots', () => {
  const overlay = {
    children: {
      a: { status: 'running' },
      b: { status: 'done' },
      c: { status: 'error' },
    },
  }
  assert.deepEqual(homeFooterCounts(overlay), { running: 1, done: 1, error: 1, total: 3 })
  overlay.children.d = { status: 'running' }
  assert.deepEqual(homeFooterCounts(overlay), { running: 2, done: 1, error: 1, total: 4 })
  assert.equal(footerVisible(homeFooterCounts(overlay)), true)
  assert.deepEqual(homeFooterCounts({ children: {} }), { running: 0, done: 0, error: 0, total: 0 })
})

test('session.created stores a sanitized title and drops secrets', () => {
  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 1,
    data: {
      sessionID: 'ses_secret',
      parentID: 'ses_root',
      agent: 'ghp_TESTTOKEN0000000000000000000000',
      title: 'ghp_TESTTOKEN0000000000000000000000',
    },
  })
  assert.equal(state.children.ses_secret.agent, undefined)
  assert.equal(state.children.ses_secret.title, undefined)
  assert.equal(JSON.stringify(state.children.ses_secret).includes('ghp_'), false)
  assert.equal(displayName(state.children.ses_secret), 'subagente')

  applySessionEvent(state, {
    type: 'session.created',
    created: 3,
    data: {
      sessionID: 'ses_titled',
      parentID: 'ses_root',
      agent: 'builder',
      title: 'reviewer',
    },
  })
  assert.equal(state.children.ses_titled.agent, 'builder')
  assert.equal(state.children.ses_titled.title, 'reviewer')
  assert.equal(displayName(state.children.ses_titled), 'builder')
  assert.equal(sanitizeTitle('reviewer'), 'reviewer')
})

test('new sessions do not store planner, but a previously stored planner still renders', () => {
  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 1,
    data: { sessionID: 'ses_new', parentID: 'ses_root', agent: 'planner', title: 'planner plan' },
  })
  assert.equal(state.children.ses_new.agent, undefined)
  assert.equal(state.children.ses_new.title, 'planner plan')
  assert.equal(displayName(state.children.ses_new), 'subagente')

  state.children.ses_old = {
    id: 'ses_old',
    parentID: 'ses_root',
    status: 'done',
    agent: 'planner',
    startedAt: 1,
    endedAt: 2,
  }
  const rows = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [{ id: 'ses_live', parentID: 'ses_root', agent: 'planner', time: { created: 3 } }],
    statusById: { ses_live: 'idle', ses_old: 'idle' },
    now: 10_000,
    showHistory: true,
  })
  const old = rows.find((row) => row.id === 'ses_old')
  const live = rows.find((row) => row.id === 'ses_live')
  assert.equal(old?.label, 'planner')
  assert.equal(displayStoredName('planner'), 'planner')
  assert.equal(live?.label, 'subagente')
  assert.equal(JSON.stringify(live).includes('planner'), false)
})

test('real sessions count once across events and hydration', () => {
  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 10,
    data: { sessionID: 'ses_child', parentID: 'ses_root', agent: 'builder', title: 'Implementá el monitor' },
  })
  applySessionEvent(state, {
    type: 'session.forked',
    created: 11,
    data: { sessionID: 'ses_child', parentID: 'ses_root' },
  })
  applySessionEvent(state, {
    type: 'session.execution.succeeded',
    created: 20,
    data: { sessionID: 'ses_child' },
  })
  reconcileParent(state, {
    parentID: 'ses_root',
    sessions: [
      {
        id: 'ses_child',
        parentID: 'ses_root',
        agent: 'builder',
        outcome: 'succeeded',
        title: 'Implementá el monitor con un prompt largo',
        time: { created: 10, updated: 20, idle: 20 },
        tokens: { input: 10, output: 5, reasoning: 0 },
      },
    ],
    statusById: { ses_child: 'idle' },
    familyIDs: ['ses_root', 'ses_child'],
    authoritative: true,
    hydrated: true,
    now: 30,
  })
  assert.equal(state.totalExecuted, 1)
  assert.equal(noteExecution(state, 'ses_child'), false)
  const rows = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [{ id: 'ses_child', parentID: 'ses_root', agent: 'builder', outcome: 'succeeded', time: { created: 10 } }],
    statusById: { ses_child: 'idle' },
    now: 30,
    showHistory: true,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'ses_child')
  assert.equal(rows[0].status, 'done')
  assert.equal(state.children.ses_child.title, 'Implementá el monitor con un prompt largo')
  assert.equal(JSON.stringify(state.children.ses_child).includes('sk-'), false)
  assert.equal(formatHeader(countRows(rows), state.totalExecuted), '●0 · ✓1 · ✕0 · Σ1')
})

test('hydration closes false running and does not restore titles or prompts', () => {
  const prompt = 'Implementá el monitor y no guardes este prompt de tarea largo'
  const state = createEmptyState()
  state.children.ses_stale = {
    id: 'ses_stale',
    parentID: 'ses_root',
    status: 'running',
    startedAt: 1,
    title: prompt,
    agent: 'planner',
  }
  state.counted = { ses_stale: true }
  state.totalExecuted = 1

  reconcileParent(state, {
    parentID: 'ses_root',
    sessions: [],
    statusById: {},
    familyIDs: ['ses_root'],
    authoritative: true,
    hydrated: true,
    now: 1 + FALSE_RUNNING_GRACE_MS - 1,
  })
  assert.equal(state.children.ses_stale.status, 'running')
  assert.equal(state.children.ses_stale.title, prompt)
  assert.equal(JSON.stringify(state.children.ses_stale).includes('sk-'), false)

  reconcileParent(state, {
    parentID: 'ses_root',
    sessions: [],
    statusById: {},
    familyIDs: ['ses_root'],
    authoritative: true,
    hydrated: true,
    now: 1 + FALSE_RUNNING_GRACE_MS,
  })
  assert.equal(state.children.ses_stale.status, 'done')
  assert.equal(state.totalExecuted, 1)
  assert.equal(state.children.ses_stale.title, prompt)
  assert.equal(state.children.ses_stale.prompt, undefined)

  const leaked = createEmptyState()
  reconcileParent(leaked, {
    parentID: 'ses_root',
    sessions: [
      {
        id: 'ses_child',
        parentID: 'ses_root',
        agent: 'builder',
        title: 'Hojería limpieza',
        prompt,
        summary: prompt,
        metadata: { title: prompt },
        instructions: prompt,
        time: { created: 1 },
      },
    ],
    statusById: { ses_child: 'running' },
    hydrated: true,
    now: 10,
  })
  assert.equal(leaked.children.ses_child.title, 'Hojería limpieza')
  assert.equal(JSON.stringify(leaked).includes(prompt), false)
  assert.equal(leaked.children.ses_child.prompt, undefined)
  assert.equal(leaked.children.ses_child.summary, undefined)
  assert.equal(leaked.children.ses_child.metadata, undefined)
  assert.equal(leaked.children.ses_child.instructions, undefined)

  const idle = createEmptyState()
  applySessionEvent(idle, {
    type: 'session.created',
    created: 5,
    data: { sessionID: 'ses_idle', parentID: 'ses_root', agent: 'judge' },
  })
  reconcileParent(idle, {
    parentID: 'ses_root',
    sessions: [{ id: 'ses_idle', parentID: 'ses_root', agent: 'judge', outcome: 'succeeded', time: { created: 5, idle: 9 } }],
    statusById: { ses_idle: 'idle' },
    hydrated: true,
    authoritative: false,
    now: 12,
  })
  assert.equal(idle.children.ses_idle.status, 'done')
  assert.equal(idle.totalExecuted, 1)

  const confirmed = createEmptyState()
  confirmed.children.ses_busy = {
    id: 'ses_busy',
    parentID: 'ses_root',
    status: 'running',
    startedAt: 1,
  }
  reconcileParent(confirmed, {
    parentID: 'ses_root',
    sessions: [],
    statusById: { ses_busy: 'running' },
    familyIDs: ['ses_root'],
    authoritative: true,
    hydrated: true,
    now: 1 + FALSE_RUNNING_GRACE_MS + 10,
  })
  assert.equal(confirmed.children.ses_busy.status, 'running')
})

test('readSessionSnapshot keeps a redacted SessionInfo title and drops secrets', () => {
  const title = 'ghp_TESTTOKEN0000000000000000000000 en el titulo'
  const snapshot = readSessionSnapshot(
    {
      list: () => [
        {
          id: 'ses_child',
          parentID: 'ses_root',
          agent: 'builder',
          title,
          outcome: 'succeeded',
          time: { created: 4, updated: 8, idle: 8 },
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 1, write: 1 }, note: title },
        },
        { id: 'ses_root', title: 'root prompt' },
      ],
      family: () => ['ses_root', 'ses_child', 'ses_missing'],
      get: (id) =>
        id === 'ses_child'
          ? {
              id,
              parentID: 'ses_root',
              agent: 'builder',
              title,
              outcome: 'succeeded',
              time: { created: 4, updated: 8, idle: 8 },
              tokens: { input: 100, output: 20, reasoning: 5 },
            }
          : undefined,
      status: (id) => (id === 'ses_child' ? 'idle' : undefined),
    },
    'ses_root',
    40,
  )
  assert.equal(snapshot.authoritative, true)
  assert.equal(snapshot.sessions.length, 1)
  assert.equal(snapshot.sessions[0].id, 'ses_child')
  assert.equal(snapshot.sessions[0].title, 'en el titulo')
  assert.equal(snapshot.statusById.ses_child, 'idle')
  assert.equal(JSON.stringify(snapshot).includes('ghp_'), false)
  assert.equal(JSON.stringify(snapshot).includes('root prompt'), false)
  assert.deepEqual(snapshot.sessions[0].tokens, { input: 100, output: 20, reasoning: 5 })
})

test('pruning retained history does not reduce the execution total', () => {
  const state = createEmptyState()
  for (let index = 0; index < HISTORY_MAX_ROWS + 2; index += 1) {
    const id = `ses_${index}`
    state.children[id] = {
      id,
      parentID: 'ses_root',
      status: 'done',
      startedAt: index,
      endedAt: index + 1,
      agent: 'builder',
    }
    noteExecution(state, id)
  }
  const total = state.totalExecuted
  pruneHistory(state, HISTORY_MAX_ROWS + 10)
  assert.equal(Object.keys(state.children).length, HISTORY_MAX_ROWS)
  assert.equal(state.totalExecuted, total)

  const aged = createEmptyState()
  aged.children.ses_old = {
    id: 'ses_old',
    parentID: 'ses_root',
    status: 'done',
    endedAt: 10,
    agent: 'explore',
  }
  noteExecution(aged, 'ses_old')
  pruneHistory(aged, 10 + HISTORY_MAX_AGE_MS + 1)
  assert.equal(aged.children.ses_old, undefined)
  assert.equal(aged.totalExecuted, 1)
})
