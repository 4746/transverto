import type {IConfig} from './config.js'
import type {ILabelAddProjectSnapshot} from './entities/label-add.js'

import {SyncRepository} from './sync.repository.js'

export interface ILabelAddLoadOptions {
  cwd?: string
}

const load = async (
  config: IConfig,
  options: ILabelAddLoadOptions = {},
): Promise<ILabelAddProjectSnapshot> => {
  const snapshot = await SyncRepository.load(config, {cwd: options.cwd})
  const byCode = new Map([
    [snapshot.source.code, snapshot.source],
    ...snapshot.targets.map(dictionary => [dictionary.code, dictionary] as const),
  ])

  return {
    config,
    cwd: snapshot.cwd,
    dictionaries: config.languages.map(language => {
      const dictionary = byCode.get(language)
      if (!dictionary) throw new Error(`Language "${language}" could not be loaded.`)
      return dictionary
    }),
    types: snapshot.types,
  }
}

export const LabelAddRepository = {load}
