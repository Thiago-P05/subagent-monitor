import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIST_COMMANDS,
  LIST_MODE,
  createUiState,
  globalLayer,
  layerInterceptsTyping,
  listLayer,
  reduceUi,
} from './focus.js'

const rows = [
  { id: 'ses_a', status: 'running' },
  { id: 'ses_b', status: 'done' },
  { id: 'ses_c', status: 'error' },
]

test('global layer exposes palette and Alt+B without stealing prompt keys', () => {
  const layer = globalLayer()
  assert.equal(layer.mode, 'global')
  assert.equal(layerInterceptsTyping(layer), false)
  const focus = layer.commands.find((command) => command.action === 'toggle-focus')
  assert.equal(focus.bind, 'alt+b')
  assert.equal(focus.palette, true)
  assert.equal(layer.commands.some((command) => command.palette && command.action === 'toggle-history'), true)
  for (const key of ['j', 'k', 'up', 'down', 'left', 'right', 'return', 'escape', 'c', 'h', 'l']) {
    assert.equal(
      layer.commands.some((command) =>
        String(command.bind ?? '')
          .split(',')
          .map((part) => part.trim())
          .includes(key),
      ),
      false,
      key,
    )
  }
})

test('list navigation is scoped to the focused list mode', () => {
  let focused = false
  const layer = listLayer(() => focused)
  assert.equal(layer.mode, LIST_MODE)
  assert.notEqual(layer.mode, 'global')
  assert.notEqual(layer.mode, 'base')
  assert.equal(layer.enabled(), false)
  focused = true
  assert.equal(layer.enabled(), true)
  assert.equal(layerInterceptsTyping(layer), false)
  const binds = Object.fromEntries(LIST_COMMANDS.map((command) => [command.action, command.bind]))
  assert.equal(binds.next, 'j,down')
  assert.equal(binds.prev, 'k,up')
  assert.equal(binds.open, 'return')
  assert.equal(binds['toggle-history'], 'c')
  assert.equal(binds.collapse, 'h,left')
  assert.equal(binds.expand, 'l,right')
  assert.equal(binds.blur, 'escape')
  assert.equal(layer.commands.every((command) => command.palette !== true), true)
})

test('j/k and Enter do nothing until the list is focused', () => {
  const idle = createUiState()
  const typed = reduceUi(idle, 'next', rows, { source: 'list' })
  assert.equal(typed.consumed, false)
  assert.equal(typed.state.focused, false)
  assert.equal(typed.state.selectedID, '')
  assert.equal(typed.openID, undefined)

  const focused = reduceUi(idle, 'toggle-focus', rows)
  assert.equal(focused.consumed, true)
  assert.equal(focused.state.focused, true)
  assert.equal(focused.state.expanded, true)
  assert.equal(focused.state.selectedID, 'ses_a')

  const down = reduceUi(focused.state, 'next', rows, { source: 'list' })
  assert.equal(down.state.selectedID, 'ses_b')
  const up = reduceUi(down.state, 'prev', rows, { source: 'list' })
  assert.equal(up.state.selectedID, 'ses_a')
  const opened = reduceUi(down.state, 'open', rows, { source: 'list' })
  assert.equal(opened.openID, 'ses_b')
  assert.equal(opened.state.focused, false)

  const again = reduceUi(focused.state, 'toggle-focus', rows)
  assert.equal(again.state.focused, false)
})

test('history, collapse and Esc stay inside list focus and open is a no-op without rows', () => {
  const focused = reduceUi(createUiState(), 'toggle-focus', rows).state
  const history = reduceUi(focused, 'toggle-history', rows, { source: 'list' })
  assert.equal(history.state.history, true)
  assert.equal(history.state.focused, true)
  const collapsed = reduceUi(history.state, 'collapse', rows, { source: 'list' })
  assert.equal(collapsed.state.expanded, false)
  const moved = reduceUi(collapsed.state, 'next', rows, { source: 'list' })
  assert.equal(moved.state.selectedID, focused.selectedID)
  const expanded = reduceUi(collapsed.state, 'expand', rows, { source: 'list' })
  assert.equal(expanded.state.expanded, true)
  const blurred = reduceUi(expanded.state, 'blur', rows, { source: 'list' })
  assert.equal(blurred.state.focused, false)

  const empty = reduceUi({ ...focused, selectedID: '' }, 'open', [], { source: 'list' })
  assert.equal(empty.openID, undefined)
  assert.equal(empty.consumed, true)
  assert.equal(empty.state.focused, true)
})