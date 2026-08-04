import {select} from '@inquirer/prompts'

import type {IIncompleteTranslationBatch, TIncompleteBatchDecision} from './entities/translation-batch.js'

type TPendingIncompleteBatch = Omit<IIncompleteTranslationBatch, 'decision'>

export const createIncompleteDecisionHandler = (options: {
  interactive: boolean
  output: NodeJS.WriteStream
}): undefined | ((batch: TPendingIncompleteBatch) => Promise<TIncompleteBatchDecision>) => {
  if (!options.interactive) return
  return async batch => select<TIncompleteBatchDecision>({
    choices: [
      {name: 'cancel translation', value: 'cancel'},
      {name: 'continue missing or invalid languages one by one', value: 'per-language'},
    ],
    message: [
      'Batch translation is incomplete.',
      `Valid: ${batch.validTargets.join(', ') || 'none'}.`,
      `Missing or invalid: ${batch.invalid.map(item => `${item.target} (${item.reason})`).join(', ') || 'none'}.`,
    ].join(' '),
  }, {output: options.output})
}
