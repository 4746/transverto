import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'

import {
  getPresetCommands,
  getPresetProvider,
  PRESET_PROVIDERS,
  resolvePresetAssetPath,
} from '../../dist/shared/preset-catalog.js'

const expected = [
  ['add', 'tl:add', String.raw`-- label:add \&quot;$SelectedText$\&quot;`],
  ['delete', 'tl:delete', String.raw`-- label:delete \&quot;$SelectedText$\&quot;`],
  ['doctor', 'tl:doctor', '-- doctor'],
  ['get', 'tl:get', String.raw`-- label:get \&quot;$SelectedText$\&quot;`],
  ['rename', 'tl:rename', String.raw`-- label:rename \&quot;$SelectedText$\&quot;`],
  ['status', 'tl:status', '-- status'],
  ['suggest', 'tl:suggest', String.raw`-- label:suggest \&quot;$SelectedText$\&quot;`],
]

test('catalog exposes one JetBrains provider and seven unique commands', () => {
  assert.deepEqual(PRESET_PROVIDERS.map(({id, name}) => ({id, name})), [
    {id: 'jetbrains', name: 'JetBrains'},
  ])
  assert.equal(getPresetProvider('jetbrains').id, 'jetbrains')
  const commands = getPresetCommands('jetbrains')
  assert.deepEqual(commands.map(({id}) => id), expected.map(([id]) => id))
  assert.equal(new Set(commands.map(({assetFile}) => assetFile)).size, 7)
  assert.equal(new Set(commands.map(({targetFile}) => targetFile)).size, 7)
  assert.throws(() => getPresetProvider('unknown'), /Unknown preset provider/)
  assert.throws(() => resolvePresetAssetPath('jetbrains', 'unknown'), /Unknown preset command/)
})

test('packaged JetBrains assets have exact names and npm arguments', async () => {
  for (const [id, configurationName, argumentsValue] of expected) {
    const file = resolvePresetAssetPath('jetbrains', id)
    assert.equal(path.basename(file), `tl_${id}.run.xml`)
    const xml = await fs.promises.readFile(file, 'utf8')
    assert.match(xml, new RegExp(`name="${configurationName}"`))
    assert.ok(xml.includes(`<arguments value="${argumentsValue}" />`), xml)
    assert.ok(xml.endsWith('\n'))
  }
})
