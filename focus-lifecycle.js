/**
 * context.storage.memory survives plugin reload. Old and new generations share
 * the live store, and `initial` is ignored once the key exists.
 *
 * Cleanup pops the list keymap mode, but a retained ui.focused=true makes the
 * next Alt+B unfocus. Reset focus on setup and cleanup so focus and mode start
 * unfocused together. Do not push the list mode back to match retained focus.
 * History and selection stay in the shared store.
 *
 * Overlapping generations share that store. Cleanup clears focus only while
 * this generation still owns it, so a newer setup is not unfocused by the
 * old teardown. If the store drops the ownership token, cleanup still clears
 * focus — that is the reload bug this module exists to close.
 */

export function resetRetainedListFocus(updateUi) {
  updateUi((draft) => {
    draft.focused = false
  })
}

function claimFocusGeneration(updateUi) {
  const token = {}
  updateUi((draft) => {
    draft.focused = false
    draft.focusToken = token
  })
  let owned = false
  updateUi((draft) => {
    owned = draft.focusToken === token
  })
  return owned ? token : undefined
}

export function createListFocusRelease({ updateUi, syncMode, token }) {
  let released = false
  return function releaseListFocus() {
    if (released) return false
    released = true
    try {
      if (typeof syncMode === 'function') syncMode(false)
    } catch {
      // mode cleanup is best-effort; focus still resets when this generation owns it
    }
    updateUi((draft) => {
      if (token === undefined || draft.focusToken === token) draft.focused = false
    })
    return true
  }
}

export function beginListFocusGeneration({ updateUi, syncMode }) {
  const token = claimFocusGeneration(updateUi)
  try {
    if (typeof syncMode === 'function') syncMode(false)
  } catch {
    // mode alignment is best-effort; focus is already clear
  }
  return createListFocusRelease({ updateUi, syncMode, token })
}

export function guardCleanup(run) {
  let disposed = false
  return function cleanup() {
    if (disposed) return
    disposed = true
    run()
  }
}
