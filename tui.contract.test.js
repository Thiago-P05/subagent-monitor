import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./tui.js', import.meta.url), 'utf8')

function slotBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = endMarker ? source.indexOf(endMarker, start + 1) : source.length
  assert.ok(start >= 0, `missing ${startMarker}`)
  assert.ok(end > start, `missing ${endMarker}`)
  return source.slice(start, end)
}

test('home footer counts are createMemo accessors and the prompt footer slot is absent', () => {
  const home = slotBlock("append: 'home.footer.status'", "append: 'app'")
  assert.match(home, /createMemo\(/)
  assert.match(home, /get when\(\)/)
  assert.match(home, /get children\(\)/)
  assert.doesNotMatch(home, /const counts = countRows\(/)
  assert.doesNotMatch(home, /when: footerVisible\(/)
  assert.match(home, /homeFooterCounts\(overlay\)/)
  assert.doesNotMatch(source, /prompt\.footer/)
  assert.doesNotMatch(source, /promptFooterCounts/)
  assert.doesNotMatch(source, /unPrompt\(/)
})

test('app keymap layer is a child component without Provider swallow', () => {
  const app = slotBlock("append: 'app'")
  assert.match(app, /jsx\(KeymapLayer/)
  assert.doesNotMatch(app, /message\.includes\(['"]Keymap\.Provider['"]\)/)
  assert.doesNotMatch(app, /bindKeymapLayer/)
})

test('navigation is list-scoped and the plugin does not persist rows or read local databases', () => {
  assert.match(source, /listLayer\(/)
  assert.match(source, /globalLayer\(/)
  assert.match(source, /LIST_MODE/)
  assert.match(source, /runAction\(command\.action, 'list'\)/)
  assert.doesNotMatch(source, /bind:\s*['"]j/)
  assert.doesNotMatch(source, /sqlite|status\.txt|state\.json|backfill|XDG_RUNTIME|readFileSync|opencode-subagent-statusline/i)
  assert.match(source, /\{\s*expanded:\s*true\s*\}/)
  assert.match(source, /memory\('overlay'/)
  assert.match(source, /memory\('ui'/)
  assert.match(source, /storage\.store\(key,\s*\{\s*initial\s*\}\)/)
  assert.doesNotMatch(source, /storage\.store\([^)]*children/)
  assert.doesNotMatch(source, /storage\.store\([^)]*title/)
  assert.doesNotMatch(source, /storage\.memory\('overlay'[\s\S]{0,80}title/)
  assert.doesNotMatch(source, /console\.(log|debug|info|warn|error)/)
  assert.doesNotMatch(source, /writeFile|appendFile|status\.txt/)
})

test('sidebar layout is a sober heading, summary line, and two-line rows', () => {
  const sidebar = slotBlock("append: 'sidebar.content'", "append: 'home.footer.status'")
  assert.match(sidebar, /sectionHeading\(/)
  assert.match(sidebar, /summaryLine\(colors, counts\(\)\)/)
  assert.match(sidebar, /countRelevantRows\(/)
  assert.doesNotMatch(sidebar, /countRows\(rows\(\)\)/)
  assert.match(source, /function rowsFor/)
  assert.match(sidebar, /formatMeta\(/)
  assert.match(sidebar, /truncateColumns\(/)
  assert.match(sidebar, /quietText\(/)
  assert.match(source, /function quietText/)
  assert.match(source, /getOwnPropertyDescriptor\(props, key\)/)
  assert.doesNotMatch(source, /function quietText[\s\S]{0,240}\.\.\.props/)
  assert.match(source, /wrapMode: 'none'/)
  assert.match(source, /function summaryLine/)
  assert.match(source, /summaryParts\(counts\)/)
  assert.match(sidebar, /overflow: 'hidden'/)
  assert.match(sidebar, /gap: 1/)
  assert.match(sidebar, /children: 'Σ'/)
  assert.match(sidebar, /toggle-section/)
  assert.match(sidebar, /toggle-history/)
  assert.match(sidebar, /router\.navigate/)
  assert.doesNotMatch(sidebar, /formatHeader/)
  assert.doesNotMatch(sidebar, /Subagentes · foco/)
  assert.doesNotMatch(sidebar, /●\$\{/)
  assert.match(source, /formatCounts\(counts\(\)\)/)
})

test('setup and cleanup keep retained list focus aligned with keymap mode', () => {
  const popLet = source.indexOf('let popListMode = null')
  const begin = source.indexOf('beginListFocusGeneration(')
  const listen = source.indexOf('context.data.on(')
  const slot = source.indexOf('context.ui.slot(')
  assert.ok(popLet >= 0, 'missing popListMode')
  assert.ok(begin > popLet, 'align focus after mode state exists')
  assert.ok(begin < listen, 'align focus before listeners')
  assert.ok(slot > begin, 'align focus before slots')
  assert.match(source, /syncMode:\s*syncListMode/)
  const cleanup = source.slice(source.lastIndexOf('guardCleanup('))
  assert.match(cleanup, /releaseListFocus\(\)/)
  assert.doesNotMatch(cleanup, /syncListMode\(false\)/)
  assert.match(source, /from '\.\/focus-lifecycle\.js'/)
})

test('documented fixture keeps this monitor as the only subagent plugin entry', () => {
  const configPath = new URL('./fixtures/cli.sample.json', import.meta.url)
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const plugins = config.plugins
  assert.ok(Array.isArray(plugins))
  const monitor = plugins.filter((entry) => {
    const value = typeof entry === 'string' ? entry : entry?.package
    return typeof value === 'string' && value.includes('subagent')
  })
  assert.deepEqual(monitor, ['./subagent-monitor'])
  assert.equal(plugins.includes('opencode-subagent-statusline'), false)
})
