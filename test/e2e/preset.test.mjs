import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  renderPresetResult,
  runPresetPrompts,
} from '../../dist/commands/preset.js'
import {createTemporaryProject, runCli} from '../helpers/project-fixture.mjs'

const inspection = conflicts => ({conflicts})
const report = {
  created: ['.run/tl_add.run.xml'],
  overwritten: ['.run/tl_get.run.xml'],
  preserved: ['.run/tl_status.run.xml'],
  script: 'added',
}

test('preset help advertises the interactive installer', async testContext => {
  const project = await createTemporaryProject(testContext)
  const result = await runCli(project, ['preset', '--help'])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /Install IDE run configuration presets/)
})

test('preset preselects all JetBrains commands and skips unnecessary confirmation', async () => {
  let providerPrompt
  let commandPrompt
  let confirmCalls = 0
  let installOptions
  const result = await runPresetPrompts('project-root', {
    async confirmOverwrite() {
      confirmCalls += 1
      return false
    },
    async inspect(input) {
      assert.deepEqual(input, {
        commands: ['add', 'delete', 'doctor', 'get', 'rename', 'status', 'suggest'],
        projectRoot: 'project-root',
        provider: 'jetbrains',
      })
      return inspection([])
    },
    async install(_inspection, options) {
      installOptions = options
      return report
    },
    async selectCommands(options) {
      commandPrompt = options
      return options.choices.map(choice => choice.value)
    },
    async selectProvider(options) {
      providerPrompt = options
      return 'jetbrains'
    },
  })

  assert.deepEqual(providerPrompt.choices, [{name: 'JetBrains', value: 'jetbrains'}])
  assert.equal(providerPrompt.message, 'Preset:')
  assert.equal(commandPrompt.message, 'Commands:')
  assert.equal(commandPrompt.required, true)
  assert.equal(commandPrompt.choices.length, 7)
  assert.ok(commandPrompt.choices.every(choice => choice.checked === true))
  assert.equal(confirmCalls, 0)
  assert.deepEqual(installOptions, {overwrite: true})
  assert.deepEqual(result, {provider: 'jetbrains', report})
})

test('preset asks once for every conflict and forwards a No answer', async () => {
  let confirmPrompt
  let installOptions
  await runPresetPrompts('project-root', {
    async confirmOverwrite(options) {
      confirmPrompt = options
      return false
    },
    async inspect() {
      return inspection(['.run/tl_add.run.xml', '.run/tl_get.run.xml'])
    },
    async install(_inspection, options) {
      installOptions = options
      return report
    },
    async selectCommands() {
      return ['add', 'get']
    },
    async selectProvider() {
      return 'jetbrains'
    },
  })

  assert.deepEqual(confirmPrompt, {
    default: true,
    message: 'Overwrite 2 existing JetBrains run configurations?',
  })
  assert.deepEqual(installOptions, {overwrite: false})
})

test('preset result renderer prints provider and exact outcome counts', () => {
  const lines = []
  renderPresetResult({provider: 'jetbrains', report}, line => lines.push(line))
  assert.deepEqual(lines, [
    'JetBrains preset installed.',
    'Created: 1',
    'Overwritten: 1',
    'Preserved: 1',
    'npm script: added',
  ])
})
