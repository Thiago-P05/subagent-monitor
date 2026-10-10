import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SIDEBAR_TITLE_COLUMNS,
  STORED_TITLE_COLUMNS,
  applySessionEvent,
  collectRows,
  columnWidth,
  containsSecret,
  countRelevantRows,
  countRows,
  createEmptyState,
  formatMeta,
  formatSummary,
  readSessionSnapshot,
  renderSidebarLines,
  sanitizeTitle,
  sectionHeading,
  truncateColumns,
} from './logic.js'
import { reduceUi } from './focus.js'

const SECRET = 'ghp_TESTTOKEN0000000000000000000000'
const XAIZA = 'xAIzaSyA-testtoken-abcdefghijklmnopqrst'

test('summary and heading match the sober sidebar structure', () => {
  const counts = { running: 1, done: 5, error: 8, total: 14 }
  assert.equal(sectionHeading('en'), 'Subagents')
  assert.equal(sectionHeading('es'), 'Subagentes')
  assert.equal(formatSummary(counts, 'en'), '• 1 running · ✓ 5 done · ✕ 8 error')
  assert.equal(formatSummary(counts, 'es'), '• 1 en curso · ✓ 5 listos · ✕ 8 errores')
  assert.equal(formatSummary(counts, 'en').includes('Σ'), false)
  assert.equal(sectionHeading('en').includes('●'), false)
})

test('sidebar snapshot keeps status markers, titles, and an indented meta line', () => {
  const lines = renderSidebarLines({
    locale: 'en',
    expanded: true,
    focused: true,
    selectedID: 'ses_done',
    width: 28,
    counts: { running: 1, done: 5, error: 8, total: 14 },
    rows: [
      {
        id: 'ses_run',
        status: 'running',
        title: 'Delegation: review the sidebar layout',
        label: 'builder',
        elapsed: '5m 26s',
        tokens: '102k',
      },
      {
        id: 'ses_done',
        status: 'done',
        title: 'Hojería limpieza',
        label: 'judge',
        elapsed: '1m 02s',
        tokens: '12k',
      },
    ],
  })

  assert.deepEqual(lines, [
    '▼ Subagents',
    '• 1 running · ✓ 5 done · ✕ 8 error',
    ' ● Delegation: review the side…',
    '   ◷ builder · 5m 26s · 102k',
    '›✓ Hojería limpieza',
    '   ◷ judge · 1m 02s · 12k',
  ])
  assert.equal(lines[2].includes('\n'), false)
  assert.ok(lines[2].endsWith('…'))
  assert.ok(columnWidth(lines[2].slice(3)) <= 28)
  assert.equal(lines[3].startsWith('   ◷ '), true)
  assert.equal(renderSidebarLines({ locale: 'es', expanded: false, rows: [{ id: 'x' }] }).join('\n'), '▶ Subagentes')
})

test('long titles truncate by columns, secrets and controls never reach render', () => {
  const long = `Delegation: ${'limpieza del sidebar '.repeat(12)}`
  const dirty = `Hojería\u0000 ${SECRET} limpieza\n\u001B[31mextra\u202E`
  assert.equal(containsSecret(dirty), true)
  assert.equal(sanitizeTitle('Hojería OPENAI_API_KEY=secret-value limpieza'), 'Hojería limpieza')
  assert.equal(sanitizeTitle(SECRET), undefined)
  assert.equal(sanitizeTitle(XAIZA), undefined)
  assert.equal(sanitizeTitle(dirty), 'Hojería limpieza extra')
  assert.equal(sanitizeTitle(dirty).includes(SECRET), false)
  assert.equal(sanitizeTitle(dirty).includes('\n'), false)
  assert.equal(sanitizeTitle(dirty).includes('\u0000'), false)
  assert.ok(columnWidth(sanitizeTitle(long)) <= STORED_TITLE_COLUMNS)
  assert.equal(sanitizeTitle(long).endsWith('…'), true)

  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 1,
    metadata: { title: `meta ${SECRET}` },
    data: {
      sessionID: 'ses_child',
      parentID: 'ses_root',
      agent: 'builder',
      title: dirty,
      metadata: { title: `bag ${SECRET}` },
      instructions: `instr ${SECRET}`,
    },
  })
  assert.equal(state.children.ses_child.title, 'Hojería limpieza extra')
  assert.equal(JSON.stringify(state).includes(SECRET), false)
  assert.equal(JSON.stringify(state).includes('meta '), false)
  assert.equal(JSON.stringify(state).includes('instr '), false)

  applySessionEvent(state, {
    type: 'session.forked',
    created: 2,
    data: {
      sessionID: 'ses_child',
      parentID: 'ses_root',
      title: `fork ${SECRET}`,
      instructions: { task: `task ${SECRET}` },
    },
  })
  assert.equal(state.children.ses_child.title, 'Hojería limpieza extra')
  assert.equal(JSON.stringify(state).includes(SECRET), false)

  applySessionEvent(state, {
    type: 'session.renamed',
    created: 3,
    metadata: { title: `rename-meta ${SECRET}` },
    data: { sessionID: 'ses_child', title: `Delegation: ${SECRET} sidebar` },
  })
  assert.equal(state.children.ses_child.title, 'Delegation: sidebar')
  assert.equal(JSON.stringify(state).includes(SECRET), false)
  assert.equal(JSON.stringify(state).includes('rename-meta'), false)

  const rows = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [
      {
        id: 'ses_child',
        parentID: 'ses_root',
        agent: 'builder',
        title: `${long} ${XAIZA}`,
        time: { created: 1 },
      },
    ],
    statusById: { ses_child: 'running' },
    now: 5_000,
    showHistory: false,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].label, 'builder')
  assert.equal(rows[0].title.includes(XAIZA), false)
  assert.equal(rows[0].title.includes('AIza'), false)
  assert.equal(rows[0].title.includes('\n'), false)
  assert.ok(columnWidth(rows[0].title) <= STORED_TITLE_COLUMNS)
  const rendered = renderSidebarLines({
    locale: 'es',
    width: SIDEBAR_TITLE_COLUMNS,
    counts: countRows(rows),
    rows,
  }).join('\n')
  assert.equal(rendered.includes(SECRET), false)
  assert.equal(rendered.includes(XAIZA), false)
  assert.equal(rendered.includes('AIza'), false)
  assert.equal(rendered.includes('\n\n'), false)
  for (const line of rendered.split('\n')) {
    assert.equal(line.includes('\n'), false)
  }
})

test('missing title falls back to the allowlisted agent', () => {
  const state = createEmptyState()
  applySessionEvent(state, {
    type: 'session.created',
    created: 1,
    data: { sessionID: 'ses_child', parentID: 'ses_root', agent: 'judge' },
  })
  assert.equal(state.children.ses_child.title, undefined)
  const rows = collectRows({
    parentID: 'ses_root',
    overlay: state,
    sessions: [],
    statusById: { ses_child: 'running' },
    now: 2_000,
    showHistory: false,
  })
  assert.equal(rows[0].title, 'judge')
  assert.equal(rows[0].label, 'judge')
  assert.match(formatMeta(rows[0], 40), /^◷ judge · /)
  const lines = renderSidebarLines({ locale: 'es', counts: countRows(rows), rows, width: 24 })
  assert.match(lines[2], /^ ● judge$/)
  assert.match(lines[3], /^   ◷ judge · /)
})

test('snapshot keeps a safe SessionInfo title and drops a secret one', () => {
  const snapshot = readSessionSnapshot(
    {
      list: () => [
        {
          id: 'ses_safe',
          parentID: 'ses_root',
          agent: 'builder',
          title: 'Hojería limpieza',
          time: { created: 1 },
        },
        {
          id: 'ses_secret',
          parentID: 'ses_root',
          agent: 'judge',
          title: `${SECRET} en el titulo`,
          metadata: { title: SECRET },
          time: { created: 2 },
        },
      ],
      family: () => ['ses_root', 'ses_safe', 'ses_secret'],
      get: (id) =>
        id === 'ses_safe'
          ? { id, parentID: 'ses_root', agent: 'builder', title: 'Hojería limpieza', time: { created: 1 } }
          : { id, parentID: 'ses_root', agent: 'judge', title: SECRET, metadata: { title: SECRET }, time: { created: 2 } },
      status: () => 'idle',
    },
    'ses_root',
    10,
  )
  const safe = snapshot.sessions.find((session) => session.id === 'ses_safe')
  const secret = snapshot.sessions.find((session) => session.id === 'ses_secret')
  assert.equal(safe.title, 'Hojería limpieza')
  assert.equal(secret.title, undefined)
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false)
  assert.equal(JSON.stringify(snapshot).includes('metadata'), false)
})

test('summary counts every relevant child while the list stays capped', () => {
  const now = Date.now()
  const parentID = 'ses_root'
  const state = createEmptyState()
  const sessions = []
  const statusById = {}
  const dirty = `Fix\n ${SECRET} sidebar`

  function track(spec) {
    applySessionEvent(state, {
      type: 'session.created',
      created: spec.startedAt,
      data: {
        sessionID: spec.id,
        parentID: spec.parentID,
        agent: spec.agent,
        title: spec.eventTitle,
      },
    })
    if (spec.status === 'done') {
      applySessionEvent(state, {
        type: 'session.execution.succeeded',
        created: spec.endedAt,
        data: { sessionID: spec.id },
      })
    } else if (spec.status === 'error') {
      applySessionEvent(state, {
        type: 'session.execution.failed',
        created: spec.endedAt,
        data: { sessionID: spec.id },
      })
    }
    sessions.push({
      id: spec.id,
      parentID: spec.parentID,
      agent: spec.agent,
      title: spec.liveTitle,
      outcome: spec.status === 'done' ? 'succeeded' : spec.status === 'error' ? 'failed' : undefined,
      time: {
        created: spec.startedAt,
        updated: spec.endedAt || spec.startedAt,
        idle: spec.status === 'running' ? undefined : spec.endedAt,
      },
      tokens: spec.tokens,
    })
    statusById[spec.id] = spec.status === 'running' ? 'running' : 'idle'
  }

  track({
    id: 'ses_run',
    parentID,
    agent: 'builder',
    status: 'running',
    startedAt: now - 1_000,
    eventTitle: dirty,
    liveTitle: dirty,
    tokens: { input: 1000, output: 0, reasoning: 0 },
  })
  for (let index = 0; index < 8; index += 1) {
    track({
      id: `ses_err_${index}`,
      parentID,
      agent: 'judge',
      status: 'error',
      startedAt: now - 2_000 - index,
      endedAt: now - 500,
      eventTitle: `Error task ${index}`,
      liveTitle: `Error task ${index}`,
    })
  }
  for (let index = 0; index < 5; index += 1) {
    track({
      id: `ses_done_${index}`,
      parentID,
      agent: 'explore',
      status: 'done',
      startedAt: now - 3_000 - index,
      endedAt: now - 1_000,
      eventTitle: index === 0 ? `Done ${SECRET} task` : `Done task ${index}`,
      liveTitle: index === 0 ? `Done ${SECRET} task` : `Done task ${index}`,
    })
  }
  track({
    id: 'ses_stale',
    parentID,
    agent: 'builder',
    status: 'done',
    startedAt: now - 20 * 60 * 1000,
    endedAt: now - 11 * 60 * 1000,
    eventTitle: 'STALE DONE',
    liveTitle: 'STALE DONE',
  })
  track({
    id: 'ses_other',
    parentID: 'ses_other',
    agent: 'judge',
    status: 'done',
    startedAt: now - 1_000,
    endedAt: now - 500,
    eventTitle: 'OTHER PARENT',
    liveTitle: 'OTHER PARENT',
  })

  assert.equal(JSON.stringify(state).includes(SECRET), false)
  assert.equal(state.children.ses_run.title, 'Fix sidebar')
  assert.equal(state.children.ses_done_0.title, 'Done task')

  const input = {
    parentID,
    overlay: state,
    sessions,
    statusById,
    now,
    showHistory: false,
  }
  const rows = collectRows(input)
  const counts = countRelevantRows(input)
  const lines = renderSidebarLines({
    locale: 'es',
    expanded: true,
    width: SIDEBAR_TITLE_COLUMNS,
    counts,
    rows,
  })

  assert.equal(rows.length, 5)
  assert.deepEqual(
    rows.map((row) => row.status),
    ['running', 'error', 'error', 'error', 'error'],
  )
  assert.equal(rows.some((row) => row.id.startsWith('ses_done_')), false)
  assert.equal(rows.some((row) => row.id === 'ses_stale' || row.id === 'ses_other'), false)
  assert.deepEqual(countRows(rows), { running: 1, done: 0, error: 4, total: 5 })
  assert.deepEqual(counts, { running: 1, done: 5, error: 8, total: 14 })
  assert.equal(lines[0], '▼ Subagentes')
  assert.equal(lines[1], '• 1 en curso · ✓ 5 listos · ✕ 8 errores')
  assert.equal(lines.length, 2 + 5 * 2)
  assert.equal(rows[0].title, 'Fix sidebar')
  assert.equal(rows[0].title.includes('\n'), false)
  assert.equal(JSON.stringify(rows).includes(SECRET), false)
  assert.equal(lines.join('\n').includes(SECRET), false)
  assert.equal(lines.join('\n').includes('STALE DONE'), false)
  assert.equal(lines.join('\n').includes('OTHER PARENT'), false)
  assert.equal(lines.join('\n').includes('Done task'), false)
  assert.match(lines[2], /● Fix sidebar/)
  assert.match(lines[3], /builder/)

  let ui = { focused: true, selectedID: '', expanded: true, history: false }
  const seen = new Set()
  for (let step = 0; step < 20; step += 1) {
    ui = reduceUi(ui, 'next', rows, { source: 'list' }).state
    seen.add(ui.selectedID)
  }
  assert.deepEqual([...seen], rows.map((row) => row.id))

  const historyInput = { ...input, showHistory: true }
  const historyRows = collectRows(historyInput)
  const historyCounts = countRelevantRows(historyInput)
  const historyLines = renderSidebarLines({
    locale: 'en',
    expanded: true,
    width: SIDEBAR_TITLE_COLUMNS,
    counts: historyCounts,
    rows: historyRows,
  })
  assert.equal(historyRows.length, 12)
  assert.deepEqual(countRows(historyRows), { running: 1, done: 3, error: 8, total: 12 })
  assert.deepEqual(historyCounts, { running: 1, done: 6, error: 8, total: 15 })
  assert.equal(historyLines[1], '• 1 running · ✓ 6 done · ✕ 8 error')
  assert.equal(historyLines.length, 2 + 12 * 2)
  assert.equal(historyLines.join('\n').includes(SECRET), false)
  assert.equal(historyLines.join('\n').includes('STALE DONE'), false)
  assert.equal(historyLines.join('\n').includes('OTHER PARENT'), false)
})

test('wide characters truncate on column boundaries', () => {
  const wide = '界'.repeat(8)
  assert.equal(columnWidth(wide), 16)
  assert.equal(truncateColumns(wide, 5), '界界…')
  assert.ok(columnWidth(truncateColumns(wide, 5)) <= 5)
})
