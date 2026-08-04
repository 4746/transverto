import type {
  ITranslationBatchConfig,
  ITranslationBatchOutput,
  ITranslationBatchSummary,
  ITranslationConflict,
  ITranslationFailed,
  ITranslationRemaining,
  ITranslationSkipped,
} from './entities/translation-batch.js'
import type {
  ITranslationRequestPlan,
  ITranslationResult,
} from './entities/translation.engine.js'

import {
  isRecoverableTranslationError,
  toTranslationError,
} from './entities/translation-error.js'
import {classifySkippedSource, comparePlaceholders} from './placeholder.js'

interface ITranslationExecutor {
  translate(request: ITranslationRequestPlan): Promise<ITranslationResult>
}

interface ITranslationBatchDependencies {
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

interface IIndexed<T> {
  index: number
  value: T
}

interface IPlannedBatch {
  remaining: Array<IIndexed<ITranslationRemaining>>
  selected: Array<IIndexed<ITranslationRequestPlan>>
  skipped: Array<IIndexed<ITranslationSkipped>>
}

interface IProcessedBatch {
  conflicts: Array<IIndexed<ITranslationConflict>>
  failed: Array<IIndexed<ITranslationFailed>>
  results: Array<IIndexed<ITranslationResult>>
}

interface IProcessResult {
  conflict?: ITranslationConflict
  failed?: ITranslationFailed
  result?: ITranslationResult
}

export interface ITranslationBatchExecutionOptions {
  config: ITranslationBatchConfig
  dryRun: boolean
}

type TBatchWithoutSummary = Omit<ITranslationBatchOutput, 'summary'>

const defaultSleep = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) return
  await new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds)
  })
}

const sortValues = <T>(values: Array<IIndexed<T>>): T[] => values
  .sort((left, right) => left.index - right.index)
  .map(entry => entry.value)

const wouldExceedLimits = (
  config: ITranslationBatchConfig,
  itemCount: number,
  characterCount: number,
): boolean => (
  (config.maxItems !== null && itemCount > config.maxItems) ||
  (config.maxChars !== null && characterCount > config.maxChars)
)

const planRequests = (
  requests: ITranslationRequestPlan[],
  config: ITranslationBatchConfig,
  dryRun: boolean,
): IPlannedBatch => {
  const remaining: Array<IIndexed<ITranslationRemaining>> = []
  const selected: Array<IIndexed<ITranslationRequestPlan>> = []
  const skipped: Array<IIndexed<ITranslationSkipped>> = []
  let characterCount = 0
  let itemCount = 0
  let limitReached = false

  for (const [index, request] of requests.entries()) {
    const skipReason = classifySkippedSource(request.sourceText)
    if (skipReason) {
      skipped.push({index, value: {reason: skipReason, request}})
      continue
    }

    const nextItemCount = itemCount + 1
    const nextCharacterCount = characterCount + request.sourceText.length
    if (limitReached || wouldExceedLimits(config, nextItemCount, nextCharacterCount)) {
      limitReached = true
      remaining.push({index, value: {reason: 'limit', request}})
      continue
    }

    itemCount = nextItemCount
    characterCount = nextCharacterCount
    if (dryRun) remaining.push({index, value: {reason: 'dry_run', request}})
    else selected.push({index, value: request})
  }

  return {remaining, selected, skipped}
}

export function summarizeTranslationBatch(
  output: TBatchWithoutSummary,
): ITranslationBatchSummary {
  return {
    cached: output.results.filter(result => result.cached).length,
    conflict: output.conflicts.length,
    failed: output.failed.length,
    remaining: output.remaining.length,
    skipped: output.skipped.length,
    translated: output.results.filter(result => !result.cached).length,
  }
}

export class TranslationBatchService {
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(
    private readonly executor: ITranslationExecutor,
    dependencies: ITranslationBatchDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? defaultSleep
  }

  async execute(
    requests: ITranslationRequestPlan[],
    options: ITranslationBatchExecutionOptions,
  ): Promise<ITranslationBatchOutput> {
    const plan = planRequests(requests, options.config, options.dryRun)
    const processed = options.dryRun
      ? {conflicts: [], failed: [], results: []}
      : await this.processSelected(plan.selected, options.config)
    const output: TBatchWithoutSummary = {
      conflicts: sortValues(processed.conflicts),
      failed: sortValues(processed.failed),
      incomplete: [],
      remaining: sortValues(plan.remaining),
      results: sortValues(processed.results),
      skipped: sortValues(plan.skipped),
    }
    const summary = summarizeTranslationBatch(output)
    const accounted = Object.values(summary).reduce((total, count) => total + count, 0)

    if (accounted !== requests.length) {
      throw new Error(`Batch outcome invariant failed: expected ${requests.length}, received ${accounted}.`)
    }

    return {...output, summary}
  }

  private createStartScheduler(config: ITranslationBatchConfig): () => Promise<void> {
    let nextStartAt = 0

    return async () => {
      const current = this.now()
      const startAt = Math.max(current, nextStartAt)
      nextStartAt = startAt + config.delayMs
      await this.sleep(Math.max(0, startAt - this.now()))
    }
  }

  private async processRequest(
    request: ITranslationRequestPlan,
    config: ITranslationBatchConfig,
    scheduleStart: () => Promise<void>,
  ): Promise<IProcessResult> {
    let attempts = 0

    while (true) {
      if (attempts > 0) {
        const backoff = Math.min(30_000, Math.max(config.delayMs, 100) * (2 ** (attempts - 1)))
        await this.sleep(backoff)
      }

      await scheduleStart()
      attempts += 1

      try {
        const result = await this.executor.translate(request)
        const placeholders = comparePlaceholders(request.sourceText, result.translatedText)
        if (!placeholders.matches) {
          return {
            conflict: {
              request,
              result,
              sourcePlaceholders: placeholders.source,
              translatedPlaceholders: placeholders.translated,
            },
          }
        }

        return {result}
      } catch (error) {
        const translationError = toTranslationError(error, 'provider_response')
        if (attempts <= config.retry && isRecoverableTranslationError(translationError)) continue

        return {
          failed: {
            attempts,
            category: translationError.category,
            message: translationError.message,
            request,
          },
        }
      }
    }
  }

  private async processSelected(
    selected: Array<IIndexed<ITranslationRequestPlan>>,
    config: ITranslationBatchConfig,
  ): Promise<IProcessedBatch> {
    const conflicts: Array<IIndexed<ITranslationConflict>> = []
    const failed: Array<IIndexed<ITranslationFailed>> = []
    const results: Array<IIndexed<ITranslationResult>> = []
    const scheduleStart = this.createStartScheduler(config)
    let cursor = 0

    const worker = async (): Promise<void> => {
      while (cursor < selected.length) {
        const entry = selected[cursor]
        cursor += 1
        const processed = await this.processRequest(entry.value, config, scheduleStart)

        if (processed.conflict) conflicts.push({index: entry.index, value: processed.conflict})
        if (processed.failed) failed.push({index: entry.index, value: processed.failed})
        if (processed.result) results.push({index: entry.index, value: processed.result})
      }
    }

    const workerCount = Math.min(config.concurrency, selected.length)
    await Promise.all(Array.from({length: workerCount}, async () => worker()))

    return {conflicts, failed, results}
  }
}
