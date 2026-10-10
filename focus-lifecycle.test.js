import test from 'node:test'
import assert from 'node:assert/strict'
import { LIST_MODE, reduceUi } from './focus.js'
import {
  beginListFocusGeneration,
  createListFocusRelease,
  guardCleanup,
  resetRetainedListFocus,
} from './focus-lifecycle.js'

function createSharedMemory() {
  const buckets = new Map()
  return {
    memory(key, { initial }) {
      if (!buckets.has(key)) buckets.set(key, { ...initial })
      const value = buckets.get(key)
      return [value, (mutate) => mutate(value)]
    },
  }
}

function createHostKeymap() {
  const stack = []
  return {
    stack,
    push(mode) {
      stack.push(mode)
      let active = true
      return () => {
        if (!active) throw new Error('double pop')
        active = false
        const index = stack.lastIndexOf(mode)
        if (index >= 0) stack.splice(index, 1)
      }
    },
  }
}

function createSync(host) {
  let popListMode = null
  return function syncListMode(focused) {
    if (focused) {
      if (!popListMode) popListMode = host.push(LIST_MODE)
      return
    }
    if (popListMode) {
      const pop = popListMode
      popListMode = null
      pop()
    }
  }
}

function boot(storage, host) {
  const [ui, updateUi] = storage.memory('ui', {
    initial: { history: false, focused: false, selectedID: '' },
  })
  const syncListMode = createSync(host)
  const releaseListFocus = beginListFocusGeneration({ updateUi, syncMode: syncListMode })
  const cleanup = guardCleanup(() => {
    releaseListFocus()
  })
  return { ui, updateUi, syncListMode, cleanup }
}

const rows = [{ id: 'ses_keep' }, { id: 'ses_b' }]

test('setup clears focus retained by a mode-only cleanup so the first Alt+B focuses', () => {
  const storage = createSharedMemory()
  const [ui, updateUi] = storage.memory('ui', {
    initial: { history: false, focused: false, selectedID: '' },
  })
  updateUi((draft) => {
    draft.focused = true
    draft.history = true
    draft.selectedID = 'ses_keep'
  })
  const host = createHostKeymap()
  const syncListMode = createSync(host)
  beginListFocusGeneration({ updateUi, syncMode: syncListMode })

  assert.equal(ui.focused, false)
  assert.equal(ui.history, true)
  assert.equal(ui.selectedID, 'ses_keep')
  assert.deepEqual(host.stack, [])

  const focused = reduceUi(
    { focused: ui.focused, selectedID: ui.selectedID, expanded: true, history: ui.history },
    'toggle-focus',
    rows,
  )
  assert.equal(focused.state.focused, true)
  assert.equal(focused.state.selectedID, 'ses_keep')
  assert.equal(focused.state.history, true)
})

test('reload teardown then setup leaves focus and mode unfocused; second cleanup is a no-op', () => {
  const storage = createSharedMemory()
  const host = createHostKeymap()
  const first = boot(storage, host)

  assert.equal(first.ui.focused, false)
  assert.deepEqual(host.stack, [])

  first.updateUi((draft) => {
    draft.focused = true
    draft.history = true
    draft.selectedID = 'ses_keep'
  })
  first.syncListMode(true)
  assert.equal(first.ui.focused, true)
  assert.deepEqual(host.stack, [LIST_MODE])

  first.cleanup()
  assert.equal(first.ui.focused, false)
  assert.equal(first.ui.history, true)
  assert.equal(first.ui.selectedID, 'ses_keep')
  assert.deepEqual(host.stack, [])

  assert.doesNotThrow(() => first.cleanup())
  assert.deepEqual(host.stack, [])

  const second = boot(storage, host)
  assert.equal(second.ui.focused, false)
  assert.equal(second.ui.history, true)
  assert.equal(second.ui.selectedID, 'ses_keep')
  assert.deepEqual(host.stack, [])

  const focused = reduceUi(
    {
      focused: second.ui.focused,
      selectedID: second.ui.selectedID,
      expanded: true,
      history: second.ui.history,
    },
    'toggle-focus',
    rows,
  )
  assert.equal(focused.state.focused, true)
  assert.notEqual(focused.state.focused, false)
})

test('release still clears retained focus when mode pop throws, and does not pop twice', () => {
  const ui = { focused: true, history: true, selectedID: 'ses_keep' }
  let pops = 0
  const release = createListFocusRelease({
    updateUi: (mutate) => mutate(ui),
    syncMode() {
      pops += 1
      throw new Error('pop failed')
    },
  })

  assert.equal(release(), true)
  assert.equal(ui.focused, false)
  assert.equal(ui.history, true)
  assert.equal(ui.selectedID, 'ses_keep')
  assert.equal(release(), false)
  assert.equal(pops, 1)
})

test('setup still clears focus when mode alignment throws', () => {
  const ui = { focused: true, history: false, selectedID: 'ses_keep' }
  let release
  assert.doesNotThrow(() => {
    release = beginListFocusGeneration({
      updateUi: (mutate) => mutate(ui),
      syncMode() {
        throw new Error('no mode')
      },
    })
  })
  assert.equal(ui.focused, false)
  assert.equal(ui.selectedID, 'ses_keep')
  assert.equal(typeof release, 'function')
  assert.equal(release(), true)
})

test('guardCleanup runs teardown once even when the first call throws', () => {
  let calls = 0
  const cleanup = guardCleanup(() => {
    calls += 1
    if (calls === 1) throw new Error('unslot failed')
  })
  assert.throws(() => cleanup(), /unslot failed/)
  assert.doesNotThrow(() => cleanup())
  assert.equal(calls, 1)
})

test('resetRetainedListFocus does not clear history or selection', () => {
  const ui = { focused: true, history: true, selectedID: 'ses_keep' }
  resetRetainedListFocus((mutate) => mutate(ui))
  assert.deepEqual(ui, { focused: false, history: true, selectedID: 'ses_keep' })
})

test('cleanup still clears focus when the store drops the ownership token', () => {
  const ui = { focused: true, history: true, selectedID: 'ses_keep' }
  const updateUi = (mutate) => {
    const draft = { ...ui }
    mutate(draft)
    ui.focused = draft.focused
    ui.history = draft.history
    ui.selectedID = draft.selectedID
  }
  updateUi((draft) => {
    draft.focused = true
  })
  const release = beginListFocusGeneration({
    updateUi,
    syncMode() {},
  })
  updateUi((draft) => {
    draft.focused = true
  })
  assert.equal(release(), true)
  assert.equal(ui.focused, false)
  assert.equal(ui.history, true)
  assert.equal(ui.selectedID, 'ses_keep')
  assert.equal(Object.hasOwn(ui, 'focusToken'), false)
})

test('older cleanup pops its mode but does not clear focus claimed by the next generation', () => {
  const storage = createSharedMemory()
  const host = createHostKeymap()
  const first = boot(storage, host)
  first.updateUi((draft) => {
    draft.focused = true
    draft.history = true
    draft.selectedID = 'ses_keep'
  })
  first.syncListMode(true)

  const second = boot(storage, host)
  second.updateUi((draft) => {
    draft.focused = true
  })
  second.syncListMode(true)
  assert.equal(host.stack.length, 2)

  first.cleanup()
  first.cleanup()
  assert.equal(second.ui.focused, true)
  assert.equal(second.ui.history, true)
  assert.equal(second.ui.selectedID, 'ses_keep')
  assert.equal(host.stack.length, 1)

  second.cleanup()
  assert.equal(second.ui.focused, false)
  assert.deepEqual(host.stack, [])
})
