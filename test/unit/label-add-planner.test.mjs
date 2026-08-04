import assert from 'node:assert/strict'
import {test} from 'node:test'

import {LabelAddPlanner} from '../../dist/shared/label-add-planner.js'
import {createConfig} from '../helpers/project-fixture.mjs'

const snapshotFor = dictionaries => {
  const languages = ['en', 'uk', 'de', 'pl'].filter(language => Object.hasOwn(dictionaries, language))
  return {
    config: createConfig({languages, source: 'en'}),
    cwd: process.cwd(),
    dictionaries: languages.map(code => ({
      bytes: Buffer.from(`${JSON.stringify(dictionaries[code])}\n`),
      code,
      dictionary: dictionaries[code],
      file: `${code}.json`,
      flat: new Map(),
    })),
    types: {bytes: null, file: 'language.ts'},
  }
}

test('plans translations from a non-default source only for missing targets', () => {
  const snapshot = snapshotFor({
    de: {},
    en: {},
    pl: {btn: {world: 'Istniejące'}},
    uk: {},
  })
  const plan = LabelAddPlanner.create(snapshot, {
    autoTranslate: true,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })

  assert.deepEqual(plan.requests, [
    {from: 'uk', key: 'btn.world', sourceText: 'Привіт, світ!', to: 'en'},
    {from: 'uk', key: 'btn.world', sourceText: 'Привіт, світ!', to: 'de'},
  ])
  assert.deepEqual(plan.preserved, ['pl'])
  assert.deepEqual(plan.emptyTargets, [])
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.languages, ['en', 'uk', 'de', 'pl'])
})

test('plans empty strings for missing targets when auto-translation is disabled', () => {
  const plan = LabelAddPlanner.create(snapshotFor({de: {}, en: {}, uk: {}}), {
    autoTranslate: false,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })

  assert.deepEqual(plan.requests, [])
  assert.deepEqual(plan.emptyTargets, ['en', 'de'])
})

test('reports every incompatible key path as a structural conflict', () => {
  const plan = LabelAddPlanner.create(snapshotFor({
    de: {btn: {world: {nested: 'value'}}},
    en: {btn: 'Button'},
    uk: {},
  }), {
    autoTranslate: true,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })

  assert.deepEqual(plan.conflicts, [
    {key: 'btn.world', language: 'en', reason: 'path_conflict'},
    {key: 'btn.world', language: 'de', reason: 'path_conflict'},
  ])
  assert.deepEqual(plan.requests, [])
})

test('rejects a source language outside the configured snapshot', () => {
  assert.throws(() => LabelAddPlanner.create(snapshotFor({en: {}, uk: {}}), {
    autoTranslate: true,
    key: 'btn.world',
    source: 'de',
    sourceText: 'Hallo Welt!',
  }), /Source language "de" is not configured/)
})
