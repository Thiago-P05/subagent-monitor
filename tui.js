import { jsx, jsxs } from '@opentui/solid/jsx-runtime'
import { For, Show, createEffect, createMemo } from 'solid-js'
import { Plugin } from '@opencode/plugin/tui'
import {
  applySessionEvent,
  collectRows,
  countRelevantRows,
  createEmptyState,
  emptyLabel,
  footerVisible,
  formatCounts,
  formatMeta,
  homeFooterCounts,
  pruneHistory,
  readSessionSnapshot,
  reconcileParent,
  sectionHeading,
  SIDEBAR_META_COLUMNS,
  SIDEBAR_TITLE_COLUMNS,
  statusGlyph,
  summaryParts,
  truncateColumns,
} from './logic.js'
import { KeymapLayer } from './keymap-layer.js'
import { LIST_MODE, globalLayer, listLayer, reduceUi } from './focus.js'
import { beginListFocusGeneration, guardCleanup } from './focus-lifecycle.js'

const EVENT_TYPES = [
  'session.created',
  'session.forked',
  'session.deleted',
  'session.status',
  'session.idle',
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
  'session.renamed',
]

const HYDRATE_MS = 5000

function themeColors(theme) {
  return {
    text: theme?.text?.base ?? theme?.text ?? '#e6edf3',
    muted: theme?.text?.muted ?? theme?.textMuted ?? '#8b949e',
    success: theme?.success ?? '#3fb950',
    warning: theme?.warning ?? '#d29922',
    error: theme?.error ?? '#f85149',
  }
}

function statusColor(colors, status) {
  if (status === 'running') return colors.warning
  if (status === 'error') return colors.error
  return colors.success
}

function quietText(props) {
  // Copy descriptors so Solid getters (fg/children) stay reactive. Object
  // spread would read them once and freeze focus, collapse, and selection.
  const merged = {
    wrapMode: 'none',
    overflow: 'hidden',
    flexShrink: 1,
  }
  for (const key of Reflect.ownKeys(props ?? {})) {
    const descriptor = Object.getOwnPropertyDescriptor(props, key)
    if (descriptor) Object.defineProperty(merged, key, descriptor)
  }
  return jsx('text', merged)
}

function summaryLine(colors, counts) {
  const parts = summaryParts(counts)
  const children = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (index > 0) children.push(quietText({ fg: colors.muted, flexShrink: 0, children: ' · ' }))
    children.push(quietText({ fg: statusColor(colors, part.status), flexShrink: 0, children: `${part.glyph} ` }))
    children.push(quietText({ fg: colors.muted, flexShrink: 1, children: part.text }))
  }
  return jsxs('box', {
    flexDirection: 'row',
    flexShrink: 1,
    overflow: 'hidden',
    children,
  })
}

function liveSnapshot(context, sessionID) {
  const sessions = context.data.session.list?.() ?? []
  const family = sessionID && context.data.session.family ? context.data.session.family(sessionID) : []
  const extra = []
  for (const id of family) {
    if (!id || id === sessionID) continue
    if (sessions.some((session) => session?.id === id)) continue
    const info = context.data.session.get?.(id)
    if (info) extra.push(info)
  }
  const statusById = {}
  for (const session of [...sessions, ...extra]) {
    if (!session?.id) continue
    try {
      statusById[session.id] = context.data.session.status(session.id)
    } catch {
      // status() can throw if the session is not cached yet
    }
  }
  return { sessions: [...sessions, ...extra], statusById }
}

function booleanPrefs(store) {
  return contextStorage(store, 'prefs', { expanded: true })
}

function contextStorage(storage, key, initial) {
  if (typeof storage.store === 'function') return storage.store(key, { initial })
  return storage.memory(key, { initial })
}

export default Plugin.define({
  id: 'subagent-monitor.cli',
  setup(context) {
    const [overlay, updateOverlay] = context.storage.memory('overlay', {
      initial: createEmptyState(),
    })
    const [prefs, updatePrefs] = booleanPrefs(context.storage)
    const [ui, updateUi] = context.storage.memory('ui', {
      initial: { history: false, focused: false, selectedID: '' },
    })
    updateOverlay((draft) => {
      pruneHistory(draft, Date.now())
    })

    let viewedSessionID = ''
    let boundSessionID = ''
    let listBox = null
    let previousFocus = null
    let popListMode = null
    let hydrateGen = 0
    let lastHydrateAt = 0

    // memory('ui') ignores initial after the first generation. Clear retained
    // focus before listeners or slots so it cannot pair with a popped mode.
    // syncListMode is a function declaration, so this call is not in its TDZ.
    const releaseListFocus = beginListFocusGeneration({ updateUi, syncMode: syncListMode })

    const stops = EVENT_TYPES.map((type) =>
      context.data.on(type, (event) => {
        const parentID = event?.data?.parentID
        const sessionID = event?.data?.sessionID
        if ((type === 'session.created' || type === 'session.forked') && parentID && sessionID) {
          void hydrate(parentID)
        }
        updateOverlay((draft) => {
          applySessionEvent(draft, event)
        })
      }),
    )

    function readUi() {
      return {
        focused: ui.focused === true,
        selectedID: typeof ui.selectedID === 'string' ? ui.selectedID : '',
        expanded: prefs.expanded !== false,
        history: ui.history === true,
      }
    }

    function applyUi(next) {
      void updatePrefs((draft) => {
        draft.expanded = next.expanded !== false
      })
      updateUi((draft) => {
        draft.history = next.history === true
        draft.focused = next.focused === true
        draft.selectedID = next.selectedID || ''
      })
      syncListMode(next.focused === true)
    }

    function syncListMode(focused) {
      if (focused) {
        if (!popListMode && typeof context.keymap.mode?.push === 'function') {
          popListMode = context.keymap.mode.push(LIST_MODE)
        }
        focusListBox()
        return
      }
      if (popListMode) {
        const pop = popListMode
        popListMode = null
        try {
          pop()
        } catch {
          // mode cleanup is best-effort
        }
      }
      blurListBox()
    }

    function focusListBox() {
      const renderer = context.renderer
      const current = renderer?.currentFocusedRenderable ?? renderer?.focusedRenderable
      if (current && current !== listBox) previousFocus = current
      if (listBox && typeof listBox.focus === 'function') {
        try {
          listBox.focus()
        } catch {
          // The host may not expose focus on the slot renderable. Mode push still scopes keys.
        }
      }
    }

    function blurListBox() {
      if (listBox && typeof listBox.blur === 'function') {
        try {
          listBox.blur()
        } catch {
          // ignore
        }
      }
      const previous = previousFocus
      previousFocus = null
      if (previous && previous !== listBox && typeof previous.focus === 'function') {
        try {
          previous.focus()
        } catch {
          // ignore
        }
      }
    }

    function monitorInput(sessionID) {
      if (!sessionID) return undefined
      const live = liveSnapshot(context, sessionID)
      return {
        parentID: sessionID,
        overlay,
        sessions: live.sessions,
        statusById: live.statusById,
        now: overlay.now || Date.now(),
        showHistory: ui.history === true,
      }
    }

    function rowsFor(sessionID) {
      const input = monitorInput(sessionID)
      return input ? collectRows(input) : []
    }

    function reconcileCached(sessionID, authoritative) {
      if (!sessionID) return
      const snapshot = readSessionSnapshot(context.data.session, sessionID, Date.now())
      updateOverlay((draft) => {
        reconcileParent(draft, {
          ...snapshot,
          authoritative: authoritative === true && snapshot.authoritative === true,
          hydrated: true,
          now: Date.now(),
        })
        draft.now = Date.now()
      })
    }

    async function hydrate(sessionID) {
      if (!sessionID || typeof context.data.session.sync !== 'function') {
        if (sessionID) reconcileCached(sessionID, false)
        return
      }
      const gen = ++hydrateGen
      let synced = false
      try {
        await context.data.session.sync(sessionID)
        synced = true
      } catch {
        // A failed sync must not close children we have not positively observed.
      }
      if (gen !== hydrateGen) return
      const family = synced ? context.data.session.family?.(sessionID) : undefined
      const missing = Array.isArray(family)
        ? family.filter((id) => id && id !== sessionID && !context.data.session.get?.(id)).slice(0, 50)
        : []
      await Promise.all(missing.map((id) => context.data.session.sync(id).catch(() => undefined)))
      if (gen !== hydrateGen) return
      lastHydrateAt = Date.now()
      reconcileCached(sessionID, synced)
    }

    function runAction(action, source) {
      const sessionID = viewedSessionID
      const rows = rowsFor(sessionID)
      const result = reduceUi(readUi(), action, rows, { source })
      if (!result.consumed && source === 'list') return false
      applyUi(result.state)
      if (result.openID) {
        context.ui.router.navigate({ type: 'session', sessionID: result.openID })
      }
      return undefined
    }

    const timer = setInterval(() => {
      const sessionID = viewedSessionID
      const children = overlay.children ?? {}
      const running = Object.values(children).some((child) => child?.status === 'running')
      if (!running) return
      updateOverlay((draft) => {
        draft.now = Date.now()
      })
      if (sessionID) {
        reconcileCached(sessionID, false)
        if (Date.now() - lastHydrateAt >= HYDRATE_MS) void hydrate(sessionID)
        return
      }
      const parents = [
        ...new Set(
          Object.values(children)
            .filter((child) => child?.status === 'running' && typeof child.parentID === 'string')
            .map((child) => child.parentID),
        ),
      ].slice(0, 5)
      for (const parentID of parents) {
        if (Date.now() - lastHydrateAt >= HYDRATE_MS) void hydrate(parentID)
      }
    }, 1000)

    const unSidebar = context.ui.slot({
      append: 'sidebar.content',
      render: ({ sessionID }) => {
        viewedSessionID = sessionID || ''
        const colors = themeColors(context.theme)
        // One snapshot for paint and the summary. rows stay capped for nav; counts do not.
        const listing = createMemo(() => {
          const input = monitorInput(sessionID)
          return {
            rows: input ? collectRows(input) : [],
            counts: countRelevantRows(input),
          }
        })
        const rows = createMemo(() => listing().rows)
        const counts = createMemo(() => listing().counts)
        const expanded = createMemo(() => prefs.expanded !== false)
        const focused = createMemo(() => ui.focused === true)
        const selectedID = createMemo(() => {
          const list = rows()
          if (list.some((row) => row.id === ui.selectedID)) return ui.selectedID
          return list[0]?.id ?? ''
        })
        createEffect(() => {
          const id = sessionID || ''
          viewedSessionID = id
          if (ui.focused === true && boundSessionID && boundSessionID !== id) {
            applyUi({ ...readUi(), focused: false })
          }
          if (boundSessionID !== id) {
            boundSessionID = id
            if (id) void hydrate(id)
          }
        })
        return jsxs('box', {
          flexDirection: 'column',
          paddingLeft: 1,
          paddingRight: 1,
          focusable: true,
          ref: (node) => {
            listBox = node || null
            if (node && ui.focused === true) focusListBox()
          },
          children: [
            jsxs('box', {
              flexDirection: 'row',
              alignItems: 'center',
              children: [
                jsxs('box', {
                  flexDirection: 'row',
                  flexShrink: 1,
                  overflow: 'hidden',
                  onMouseDown: () => runAction('toggle-section'),
                  children: [
                    quietText({
                      flexShrink: 0,
                      get fg() {
                        return colors.muted
                      },
                      get children() {
                        return expanded() ? '▼ ' : '▶ '
                      },
                    }),
                    quietText({
                      get fg() {
                        return focused() ? colors.warning : colors.text
                      },
                      get children() {
                        return sectionHeading()
                      },
                    }),
                  ],
                }),
                jsx('box', { flexGrow: 1 }),
                quietText({
                  flexShrink: 0,
                  onMouseDown: () => runAction('toggle-history'),
                  get fg() {
                    return ui.history === true ? colors.warning : colors.muted
                  },
                  children: 'Σ',
                }),
              ],
            }),
            jsx(Show, {
              get when() {
                return expanded()
              },
              get children() {
                return jsxs('box', {
                  flexDirection: 'column',
                  gap: 1,
                  overflow: 'hidden',
                  children: [
                    summaryLine(colors, counts()),
                    jsx(Show, {
                      get when() {
                        return rows().length > 0
                      },
                      get fallback() {
                        return quietText({ fg: colors.muted, children: `  ${emptyLabel()}` })
                      },
                      get children() {
                        return jsx(For, {
                          get each() {
                            return rows()
                          },
                          children: (row) =>
                            jsxs('box', {
                              flexDirection: 'column',
                              gap: 0,
                              overflow: 'hidden',
                              onMouseDown: () => {
                                applyUi({ ...readUi(), focused: false, selectedID: row.id })
                                context.ui.router.navigate({ type: 'session', sessionID: row.id })
                              },
                              children: [
                                jsxs('box', {
                                  flexDirection: 'row',
                                  flexShrink: 1,
                                  overflow: 'hidden',
                                  children: [
                                    quietText({
                                      flexShrink: 0,
                                      get fg() {
                                        return focused() && selectedID() === row.id ? colors.warning : colors.muted
                                      },
                                      get children() {
                                        return focused() && selectedID() === row.id ? '›' : ' '
                                      },
                                    }),
                                    quietText({
                                      fg: statusColor(colors, row.status),
                                      flexShrink: 0,
                                      children: `${statusGlyph(row.status)} `,
                                    }),
                                    quietText({
                                      get fg() {
                                        return focused() && selectedID() === row.id ? colors.warning : colors.text
                                      },
                                      get children() {
                                        return truncateColumns(row.title || row.label, SIDEBAR_TITLE_COLUMNS)
                                      },
                                    }),
                                  ],
                                }),
                                quietText({
                                  fg: colors.muted,
                                  get children() {
                                    return `   ${formatMeta(row, SIDEBAR_META_COLUMNS)}`
                                  },
                                }),
                              ],
                            }),
                        })
                      },
                    }),
                  ],
                })
              },
            }),
          ],
        })
      },
    })

    const unHome = context.ui.slot({
      append: 'home.footer.status',
      render: () => {
        const colors = themeColors(context.theme)
        const counts = createMemo(() => homeFooterCounts(overlay))
        return jsx(Show, {
          get when() {
            return footerVisible(counts())
          },
          get children() {
            return jsx('text', {
              fg: colors.muted,
              get children() {
                return `Subagentes ${formatCounts(counts())}`
              },
            })
          },
        })
      },
    })

    const unApp = context.ui.slot({
      append: 'app',
      render: () =>
        jsx(KeymapLayer, {
          keymap: context.keymap,
          factory: () => {
            const layer = globalLayer()
            return {
              mode: layer.mode,
              commands: layer.commands.map((command) => ({
                id: command.id,
                title: command.title,
                description: command.description,
                group: command.group,
                bind: command.bind,
                palette: command.palette,
                run: () => runAction(command.action),
              })),
            }
          },
        }),
    })

    const unListKeys = context.ui.slot({
      append: 'app',
      render: () =>
        jsx(KeymapLayer, {
          keymap: context.keymap,
          factory: () => {
            // Read focus in the factory so the keymap binding recomputes with the store.
            ui.focused
            const layer = listLayer(() => ui.focused === true)
            return {
              mode: layer.mode,
              priority: layer.priority,
              enabled: () => ui.focused === true,
              commands: layer.commands.map((command) => ({
                id: command.id,
                title: command.title,
                group: command.group,
                bind: command.bind,
                run: () => runAction(command.action, 'list'),
              })),
            }
          },
        }),
    })

    return guardCleanup(() => {
      clearInterval(timer)
      hydrateGen += 1
      releaseListFocus()
      for (const stop of stops) stop()
      unSidebar()
      unHome()
      unApp()
      unListKeys()
    })
  },
})
