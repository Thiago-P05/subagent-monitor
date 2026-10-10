/**
 * Keyboard contract for the existing sidebar list.
 *
 * OpenCode V2 keymap layers default to mode "base" (the prompt). "global" is
 * always active. Navigation keys must live only in a custom mode that the TUI
 * pushes while the list is focused, otherwise j/k would steal prompt typing.
 * Docs: https://opencode.ai/v2/docs/build/plugins/cli
 * Host: packages/tui/src/context/keymap.tsx (v2.0.18) — mode "global" opts out
 * of scoping; any other mode, including the default "base", is exclusive.
 */

export const LIST_MODE = 'subagent-monitor.list'

const TYPING_KEYS = new Set([
  'j',
  'k',
  'h',
  'l',
  'c',
  'up',
  'down',
  'left',
  'right',
  'return',
  'enter',
  'escape',
  'esc',
])

export const GLOBAL_COMMANDS = [
  {
    id: 'subagent-monitor.focus',
    title: 'Subagentes: enfocar lista',
    description: 'Alt+B enfoca la lista del sidebar. j/k y flechas solo actúan con esa lista enfocada.',
    group: 'Subagentes',
    bind: 'alt+b',
    palette: true,
    action: 'toggle-focus',
  },
  {
    id: 'subagent-monitor.toggle',
    title: 'Subagentes: mostrar u ocultar sección',
    description: 'No reemplaza Context ni MCP; solo la sección de subagentes',
    group: 'Subagentes',
    palette: true,
    action: 'toggle-section',
  },
  {
    id: 'subagent-monitor.history',
    title: 'Subagentes: historial reciente',
    description: 'Mostrar u ocultar subagentes terminados retenidos. Atajo: c con la lista enfocada.',
    group: 'Subagentes',
    palette: true,
    action: 'toggle-history',
  },
]

export const LIST_COMMANDS = [
  { id: 'subagent-monitor.next', title: 'Siguiente subagente', bind: 'j,down', action: 'next' },
  { id: 'subagent-monitor.prev', title: 'Subagente anterior', bind: 'k,up', action: 'prev' },
  { id: 'subagent-monitor.open', title: 'Abrir subagente', bind: 'return', action: 'open' },
  { id: 'subagent-monitor.history.key', title: 'Historial de subagentes', bind: 'c', action: 'toggle-history' },
  { id: 'subagent-monitor.collapse', title: 'Colapsar subagentes', bind: 'h,left', action: 'collapse' },
  { id: 'subagent-monitor.expand', title: 'Expandir subagentes', bind: 'l,right', action: 'expand' },
  { id: 'subagent-monitor.blur', title: 'Devolver foco al prompt', bind: 'escape', action: 'blur' },
]

export function bindKeys(bind) {
  return String(bind ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function globalLayer() {
  return {
    mode: 'global',
    commands: GLOBAL_COMMANDS.map((command) => ({ ...command })),
  }
}

export function listLayer(enabled) {
  return {
    mode: LIST_MODE,
    priority: 20,
    enabled,
    commands: LIST_COMMANDS.map((command) => ({
      id: command.id,
      title: command.title,
      group: 'Subagentes',
      bind: command.bind,
      action: command.action,
    })),
  }
}

export function layerInterceptsTyping(layer) {
  if (!layer || layer.mode === LIST_MODE) return false
  const scoped = layer.mode === 'global' || layer.mode === 'base' || layer.mode === undefined
  if (!scoped) return false
  for (const command of layer.commands ?? []) {
    for (const key of bindKeys(command.bind)) {
      if (TYPING_KEYS.has(key)) return true
    }
  }
  return false
}

export function createUiState() {
  return { focused: false, selectedID: '', expanded: true, history: false }
}

function visibleRows(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : []
}

function keepOrFirst(selectedID, rows) {
  if (selectedID && rows.some((row) => row.id === selectedID)) return selectedID
  return rows[0]?.id ?? ''
}

function moveSelection(selectedID, rows, delta) {
  if (rows.length === 0) return ''
  const index = rows.findIndex((row) => row.id === selectedID)
  const start = index >= 0 ? index : delta > 0 ? -1 : rows.length
  const next = Math.min(rows.length - 1, Math.max(0, start + delta))
  return rows[next].id
}

export function reduceUi(state, action, rows, options = {}) {
  const current = {
    focused: state?.focused === true,
    selectedID: typeof state?.selectedID === 'string' ? state.selectedID : '',
    expanded: state?.expanded !== false,
    history: state?.history === true,
  }
  const visible = visibleRows(rows)
  const fromList = options.source === 'list'

  if (fromList && !current.focused) {
    return { state: current, consumed: false, openID: undefined }
  }

  if (action === 'toggle-focus') {
    if (current.focused) {
      return { state: { ...current, focused: false }, consumed: true, openID: undefined }
    }
    return {
      state: { ...current, focused: true, expanded: true, selectedID: keepOrFirst(current.selectedID, visible) },
      consumed: true,
      openID: undefined,
    }
  }

  if (action === 'toggle-section') {
    const expanded = !current.expanded
    return {
      state: { ...current, expanded, focused: expanded ? current.focused : false },
      consumed: true,
      openID: undefined,
    }
  }

  if (action === 'toggle-history') {
    return { state: { ...current, history: !current.history }, consumed: true, openID: undefined }
  }

  if (action === 'collapse') {
    return { state: { ...current, expanded: false }, consumed: true, openID: undefined }
  }

  if (action === 'expand') {
    return { state: { ...current, expanded: true }, consumed: true, openID: undefined }
  }

  if (action === 'blur') {
    return { state: { ...current, focused: false }, consumed: true, openID: undefined }
  }

  if (action === 'next' || action === 'prev') {
    if (!current.expanded) return { state: current, consumed: true, openID: undefined }
    return {
      state: {
        ...current,
        selectedID: moveSelection(current.selectedID, visible, action === 'next' ? 1 : -1),
      },
      consumed: true,
      openID: undefined,
    }
  }

  if (action === 'open') {
    const selected = visible.find((row) => row.id === current.selectedID) ?? visible[0]
    if (!selected?.id) return { state: current, consumed: true, openID: undefined }
    return { state: { ...current, focused: false, selectedID: selected.id }, consumed: true, openID: selected.id }
  }

  return { state: current, consumed: false, openID: undefined }
}
