import assert from 'node:assert/strict'
import {PassThrough} from 'node:stream'
import {test} from 'node:test'

import {resolveLabelRenameTarget} from '../../dist/shared/label-rename-target.prompt.js'

test('provided rename target is returned without a prompt', async () => {
  let calls = 0
  const target = await resolveLabelRenameTarget({
    interactive: false,
    newPath: 'home.heading',
    output: new PassThrough(),
  }, async () => {
    calls += 1
    return 'unused'
  })

  assert.equal(target, 'home.heading')
  assert.equal(calls, 0)
})

test('missing non-interactive rename target is a usage error', async () => {
  await assert.rejects(resolveLabelRenameTarget({
    interactive: false,
    output: new PassThrough(),
  }), /Missing target key.*non-interactively/)
})

test('missing interactive rename target is requested in the terminal', async () => {
  const output = new PassThrough()
  let received
  const value = await resolveLabelRenameTarget({interactive: true, output}, async (...args) => {
    received = args
    return 'home.heading'
  })

  assert.equal(value, 'home.heading')
  assert.equal(received[0].message, 'New translation key:')
  assert.equal(received[0].validate(''), 'New translation key is required.')
  assert.equal(received[0].validate('home.heading'), true)
  assert.equal(received[1].output, output)
})
