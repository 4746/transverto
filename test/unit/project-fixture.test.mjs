import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'

import {createProject, pathExists, readJson} from '../helpers/project-fixture.mjs'

test('createProject isolates a complete fixture below the OS temp directory', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {
      en: {hello: 'Hello'},
      uk: {},
    },
  })

  assert.equal(project.root.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), true)
  assert.equal(pathExists(project.configFile), true)
  assert.deepEqual(await readJson(project.file('en')), {hello: 'Hello'})
  assert.deepEqual(await readJson(project.file('uk')), {})
})
