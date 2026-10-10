import test from 'node:test'
import assert from 'node:assert/strict'
import { createKeymapSlotRender, isKeymapProviderMissing, KeymapLayer } from './keymap-layer.js'

test('cold slot render does not call keymap.layer until the child mounts', () => {
  let calls = 0
  const keymap = {
    layer() {
      calls += 1
    },
  }
  const factory = () => ({ mode: 'global', commands: [] })
  const render = createKeymapSlotRender(keymap, factory)
  const vnode = render()
  assert.equal(calls, 0)
  assert.equal(vnode.type, KeymapLayer)
  assert.equal(vnode.props.keymap, keymap)
  assert.equal(vnode.props.factory, factory)
  KeymapLayer(vnode.props)
  assert.equal(calls, 1)
})

test('Keymap.Provider missing on mount is not swallowed', () => {
  const keymap = {
    layer() {
      throw new Error('Keymap.Provider is missing')
    },
  }
  assert.equal(isKeymapProviderMissing(new Error('Keymap.Provider is missing')), true)
  assert.throws(() => KeymapLayer({ keymap, factory: () => ({}) }), /Keymap\.Provider/)
})

test('non-provider keymap errors propagate', () => {
  const keymap = {
    layer() {
      throw new Error('layer exploded')
    },
  }
  assert.throws(() => KeymapLayer({ keymap, factory: () => ({}) }), /layer exploded/)
})
