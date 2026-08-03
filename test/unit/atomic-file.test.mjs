import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'

import {applyFileTransaction} from '../../dist/shared/atomic-file.js'
import {
  createTemporaryProject,
  pathExists,
  readBytes,
  writeText,
} from '../helpers/project-fixture.mjs'

test('file transaction creates, updates, and deletes files together', async testContext => {
  const project = await createTemporaryProject(testContext)
  const created = path.join(project.root, 'created.txt')
  const updated = path.join(project.root, 'updated.txt')
  const deleted = path.join(project.root, 'deleted.txt')
  await writeText(updated, 'old')
  await writeText(deleted, 'remove me')

  await applyFileTransaction([
    {content: 'created', file: created},
    {content: 'updated', file: updated},
    {delete: true, file: deleted},
  ])

  assert.equal((await readBytes(created)).toString('utf8'), 'created')
  assert.equal((await readBytes(updated)).toString('utf8'), 'updated')
  assert.equal(pathExists(deleted), false)
})

test('file transaction rejects duplicate targets before writing', async testContext => {
  const project = await createTemporaryProject(testContext)
  const file = path.join(project.root, 'duplicate.txt')
  await writeText(file, 'original')

  await assert.rejects(
    applyFileTransaction([
      {content: 'first', file},
      {content: 'second', file},
    ]),
    /cannot mutate the same path more than once/,
  )
  assert.equal((await readBytes(file)).toString('utf8'), 'original')
})

test('file transaction rejects stale preconditions before writing', async testContext => {
  const project = await createTemporaryProject(testContext)
  const file = path.join(project.root, 'stale.txt')
  await writeText(file, 'current')

  await assert.rejects(
    applyFileTransaction(
      [{content: 'next', file}],
      {preconditions: [{expected: Buffer.from('previous'), file}]},
    ),
    /File changed after sync planning/,
  )
  assert.equal((await readBytes(file)).toString('utf8'), 'current')
})

test('file transaction rejects missing content without changing the file', async testContext => {
  const project = await createTemporaryProject(testContext)
  const file = path.join(project.root, 'missing-content.txt')
  await writeText(file, 'original')

  await assert.rejects(
    applyFileTransaction([{file}]),
    /Missing content/,
  )
  assert.equal((await readBytes(file)).toString('utf8'), 'original')
})

test('file transaction restores an earlier mutation when a later write fails', async testContext => {
  const project = await createTemporaryProject(testContext)
  const first = path.join(project.root, 'first.txt')
  const blocker = path.join(project.root, 'blocker')
  await writeText(first, 'old')
  await writeText(blocker, 'not-a-directory')

  await assert.rejects(applyFileTransaction([
    {content: 'new', file: first},
    {content: 'second', file: path.join(blocker, 'child.txt')},
  ]))
  assert.equal((await fs.promises.readFile(first, 'utf8')), 'old')
})
