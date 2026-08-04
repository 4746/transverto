import type {IConfig} from '../config.js'
import type {ISyncDictionarySnapshot, ISyncFileSnapshot} from './sync.js'
import type {ITranslationRequestPlan} from './translation.engine.js'

export interface ILabelAddConflict {
  readonly key: string
  readonly language: string
  readonly reason: 'path_conflict'
}

export interface ILabelAddPlan {
  readonly autoTranslate: boolean
  readonly conflicts: readonly ILabelAddConflict[]
  readonly emptyTargets: readonly string[]
  readonly key: string
  readonly languages: readonly string[]
  readonly preserved: readonly string[]
  readonly requests: readonly ITranslationRequestPlan[]
  readonly source: string
  readonly sourceText: string
}

export interface ILabelAddProjectSnapshot {
  readonly config: IConfig
  readonly cwd: string
  readonly dictionaries: readonly ISyncDictionarySnapshot[]
  readonly types: ISyncFileSnapshot
}
