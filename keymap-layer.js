/**
 * keymap.layer() is owned by the calling Solid component and reads Keymap.Provider
 * from the current owner. The host may evaluate a slot's `render()` outside that
 * tree on cold load. Returning a child component means that evaluation only
 * creates a vnode; layer() runs later, when Solid mounts the child under the
 * provider. Do not catch-and-swallow Keymap.Provider errors: a mount-time miss
 * is a real failure, not something a later parent rerender will retry.
 */
export function isKeymapProviderMissing(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Keymap.Provider')
}

export function KeymapLayer(props) {
  props.keymap.layer(props.factory)
  return null
}

export function createKeymapSlotRender(keymap, factory) {
  return function KeymapSlotRender() {
    return { type: KeymapLayer, props: { keymap, factory } }
  }
}
