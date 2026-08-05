import assert from 'node:assert/strict'
import {test} from 'node:test'

import {confirmLabelAddOverwrite} from '../../dist/shared/label-add-overwrite.prompt.js'

test('configures an interactive overwrite prompt with No as the default', async () => {
  let received
  const answer = await confirmLabelAddOverwrite(
    {interactive: true, key: 'title.data'},
    async (config, context) => {
      received = {config, context}
      return false
    },
  )

  assert.equal(answer, false)
  assert.deepEqual(received.config, {
    default: false,
    message: 'Key "title.data" already exists. Overwrite it?',
  })
  assert.equal(received.context.output, process.stdout)
})

test('returns an accepted interactive overwrite', async () => {
  const answer = await confirmLabelAddOverwrite(
    {interactive: true, key: 'title.data'},
    async () => true,
  )

  assert.equal(answer, true)
})

test('rejects a required overwrite confirmation non-interactively', async () => {
  let asked = false
  await assert.rejects(
    confirmLabelAddOverwrite(
      {interactive: false, key: 'title.data'},
      async () => {
        asked = true
        return true
      },
    ),
    /Translation key "title\.data" already exists; overwriting it requires interactive confirmation/,
  )
  assert.equal(asked, false)
})
