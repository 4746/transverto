import type {
  IIncompleteTranslationBatch,
  ITranslationBatchConfig,
  ITranslationBatchOutput,
  ITranslationBatchSummary,
  ITranslationConflict,
  ITranslationFailed,
  ITranslationRemaining,
  ITranslationSkipped,
  TIncompleteBatchDecision,
} from './entities/translation-batch.js'
import type {
  IMultiLanguageTranslationAttempt,
  IMultiLanguageTranslationRequestPlan,
  ITranslationRequestPlan,
  ITranslationResult,
} from './entities/translation.engine.js'

import {
  isRecoverableTranslationError,
  toTranslationError,
} from './entities/translation-error.js'
import {classifySkippedSource, comparePlaceholders} from './placeholder.js'

interface ITranslationExecutor {
  cacheResults?(results: ITranslationResult[]): Promise<void>
  translate(request: ITranslationRequestPlan): Promise<ITranslationResult>
  translateBatch?(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageTranslationAttempt>
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

interface ITranslationGroup {
  entries: Array<IIndexed<ITranslationRequestPlan>>
  request: IMultiLanguageTranslationRequestPlan
}

interface IMultiLanguageProcessed extends IProcessedBatch {
  cancelled: boolean
  incomplete: IIncompleteTranslationBatch[]
}

interface IProcessResult {
  conflict?: ITranslationConflict
  failed?: ITranslationFailed
  result?: ITranslationResult
}

export interface ITranslationBatchExecutionOptions {
  config: ITranslationBatchConfig
  dryRun: boolean
  onIncomplete?: (
    batch: Omit<IIncompleteTranslationBatch, 'decision'>,
  ) => Promise<TIncompleteBatchDecision>
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
    const processed: IMultiLanguageProcessed = options.dryRun
      ? {cancelled: false, conflicts: [], failed: [], incomplete: [], results: []}
      : options.config.mode === 'multi-language'
        ? await this.processMultiLanguage(plan.selected, options)
        : {...await this.processSelected(plan.selected, options.config), cancelled: false, incomplete: []}
    const cancelledRemaining = processed.cancelled
      ? plan.selected.map(entry => ({index: entry.index, value: {reason: 'incomplete_batch' as const, request: entry.value}}))
      : []
    const output: TBatchWithoutSummary = {
      conflicts: processed.cancelled ? [] : sortValues(processed.conflicts),
      failed: processed.cancelled ? [] : sortValues(processed.failed),
      incomplete: processed.incomplete,
      remaining: sortValues([...plan.remaining, ...cancelledRemaining]),
      results: processed.cancelled ? [] : sortValues(processed.results),
      skipped: sortValues(plan.skipped),
    }
    if (!processed.cancelled && !options.dryRun && options.config.mode === 'multi-language') {
      await this.executor.cacheResults?.(output.results.filter(result => !result.cached))
    }

    const summary = summarizeTranslationBatch(output)
    const accounted = Object.values(summary).reduce((total, count) => total + count, 0)

    if (accounted !== requests.length) {
      throw new Error(`Batch outcome invariant failed: expected ${requests.length}, received ${accounted}.`)
    }

    return {...output, summary}
  }

  private appendRecoveryEntries(
    issues: IMultiLanguageTranslationAttempt['issues'],
    byTarget: Map<string, IIndexed<ITranslationRequestPlan>>,
    recover: Array<IIndexed<ITranslationRequestPlan>>,
  ): void {
    for (const issue of issues) {
      const entry = byTarget.get(issue.target)
      if (entry) recover.push(entry)
    }
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

  private groupRequests(selected: Array<IIndexed<ITranslationRequestPlan>>): ITranslationGroup[] {
    const groups = new Map<string, ITranslationGroup>()
    for (const entry of selected) {
      const key = JSON.stringify([entry.value.from, entry.value.key ?? null, entry.value.sourceText])
      let group = groups.get(key)
      if (!group) {
        group = {
          entries: [],
          request: {
            from: entry.value.from,
            ...(entry.value.key ? {key: entry.value.key} : {}),
            sourceText: entry.value.sourceText,
            targets: [],
          },
        }
        groups.set(key, group)
      }

      group.entries.push(entry)
      group.request.targets.push(entry.value.to)
    }

    return [...groups.values()]
  }

  private async processMultiLanguage(
    selected: Array<IIndexed<ITranslationRequestPlan>>,
    options: ITranslationBatchExecutionOptions,
  ): Promise<IMultiLanguageProcessed> {
    if (!this.executor.translateBatch) throw new Error('Multi-language executor is not configured.')
    const groups = this.groupRequests(selected)
    const conflicts: Array<IIndexed<ITranslationConflict>> = []
    const failed: Array<IIndexed<ITranslationFailed>> = []
    const incomplete: IIncompleteTranslationBatch[] = []
    const results: Array<IIndexed<ITranslationResult>> = []
    const recover: Array<IIndexed<ITranslationRequestPlan>> = []
    const scheduleStart = this.createStartScheduler(options.config)
    let cancelled = false
    let cursor = 0
    let decisionChain = Promise.resolve()

    const decide = async (pending: Omit<IIncompleteTranslationBatch, 'decision'>): Promise<TIncompleteBatchDecision> => {
      let decision: TIncompleteBatchDecision = 'cancel'
      decisionChain = decisionChain.then(async () => {
        decision = options.onIncomplete ? await options.onIncomplete(pending) : 'cancel'
      })
      await decisionChain
      return decision
    }

    const worker = async (): Promise<void> => {
      while (cursor < groups.length) {
        const group = groups[cursor]
        cursor += 1
        let attempts = 0
        let attempt: IMultiLanguageTranslationAttempt | undefined
        let failure
        while (!attempt) {
          if (attempts > 0) {
            const backoff = Math.min(30_000, Math.max(options.config.delayMs, 100) * (2 ** (attempts - 1)))
            await this.sleep(backoff)
          }

          await scheduleStart()
          attempts += 1
          try { attempt = await this.executor.translateBatch!(group.request) }
          catch (error) {
            failure = toTranslationError(error, 'provider_response')
            if (attempts <= options.config.retry && isRecoverableTranslationError(failure)) continue
            break
          }
        }

        if (!attempt) {
          for (const entry of group.entries) {
            failed.push({index: entry.index, value: {
              attempts, category: failure.category, message: failure.message, request: entry.value,
            }})
          }

          continue
        }

        const byTarget = new Map(group.entries.map(entry => [entry.value.to, entry]))
        if (attempt.issues.length > 0) {
          const validTargets = attempt.results.map(result => result.to)
          const pending = {
            from: group.request.from,
            invalid: attempt.issues,
            ...(group.request.key ? {key: group.request.key} : {}),
            requestedTargets: group.request.targets,
            sourceText: group.request.sourceText,
            unexpectedTargets: attempt.unexpectedTargets,
            validTargets,
          }
          const decision = await decide(pending)
          incomplete.push({...pending, decision})
          if (decision === 'cancel') cancelled = true
          else this.appendRecoveryEntries(attempt.issues, byTarget, recover)
        }

        for (const result of attempt.results) {
          const entry = byTarget.get(result.to)
          if (entry) results.push({index: entry.index, value: result})
        }
      }
    }

    await Promise.all(Array.from({length: Math.min(options.config.concurrency, groups.length)}, async () => worker()))
    if (cancelled) return {cancelled, conflicts, failed, incomplete, results}
    const recovered = await this.processSelected(recover, options.config)
    conflicts.push(...recovered.conflicts)
    failed.push(...recovered.failed)
    results.push(...recovered.results)
    return {cancelled, conflicts, failed, incomplete, results}
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
