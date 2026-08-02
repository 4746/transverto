import type {CommandError, OclifError} from '@oclif/core/interfaces'

import {select} from '@inquirer/prompts'
import {Args, Flags} from '@oclif/core'
import path from 'node:path'

import type {
  ITranslationBatchOutput,
  ITranslationSkipped,
} from '../shared/entities/translation-batch.js'
import type {
  ITranslateOutput,
  ITranslationRequestPlan,
  ITranslationResult,
} from '../shared/entities/translation.engine.js'

import {validateLanguageCodes} from '../shared/config-builder.js'
import {CTV_TRANSLATION_CACHE_FILE} from '../shared/constants.js'
import {TranslationError} from '../shared/entities/translation-error.js'
import {LabelBaseCommand} from '../shared/label-base.command.js'
import {resolveTranslationBatchConfig} from '../shared/translation-batch.config.js'
import {
  summarizeTranslationBatch,
  TranslationBatchService,
} from '../shared/translation-batch.service.js'
import {TranslationProjectService} from '../shared/translation-project.service.js'
import {TranslationService} from '../shared/translation.service.js'

interface ITranslateFlagInput {
  confirm: boolean
  dryRun: boolean
  from: string
  keys?: string[]
  stdin: boolean
  targets: string[]
  text?: string
  write: boolean
}
interface IBatchFlagOverrides {
  concurrency?: number
  delayMs?: number
  maxChars?: number
  maxItems?: number
  retry?: number
}


export default class Translate extends LabelBaseCommand<typeof Translate> {
  static args = {
    text: Args.string({description: 'text to translate', ignoreStdin: true}),
  }

  static description = 'Translate text or configured translation keys with an AI model'

  static enableJsonFlag = true

  static examples = [
    '<%= config.bin %> <%= command.id %> "Hello" --from en --to uk',
    'echo "Hello" | <%= config.bin %> <%= command.id %> --stdin --to uk --to de',
    '<%= config.bin %> <%= command.id %> --key home.title --to uk',
    '<%= config.bin %> <%= command.id %> --key home.title --to uk --write',
    '<%= config.bin %> <%= command.id %> --key home.title --to uk --dry-run --json',
    '<%= config.bin %> <%= command.id %> "Hello" --to uk --fallback openrouter',
    '<%= config.bin %> <%= command.id %> "Hello" --to uk --no-fallback',
    '<%= config.bin %> <%= command.id %> --key home.title --to uk --concurrency 2 --max-items 10',
    '<%= config.bin %> <%= command.id %> --key home.title --to uk --write --confirm',
  ]

  static flags = {
    concurrency: Flags.integer({description: 'maximum simultaneous translation attempts'}),
    confirm: Flags.boolean({description: 'accept or skip each safe result before writing'}),
    'delay-ms': Flags.integer({description: 'minimum milliseconds between attempt starts'}),
    'dry-run': Flags.boolean({
      description: 'validate and show requests without network calls or writes',
    }),
    engine: Flags.string({description: 'named engine profile'}),
    fallback: Flags.string({
      description: 'single fallback engine profile for this run',
      exclusive: ['no-fallback'],
    }),
    from: Flags.string({description: 'source language code'}),
    key: Flags.string({description: 'translation key', multiple: true}),
    'max-chars': Flags.integer({description: 'maximum source characters in this batch'}),
    'max-items': Flags.integer({description: 'maximum requests in this batch'}),
    'no-fallback': Flags.boolean({description: 'disable the configured fallback for this run'}),
    retry: Flags.integer({description: 'recoverable retries after the first attempt'}),
    stdin: Flags.boolean({description: 'read source text from stdin'}),
    to: Flags.string({description: 'target language code', multiple: true, required: true}),
    write: Flags.boolean({description: 'write key translations to target dictionaries'}),
  }

  protected async catch(error: CommandError): Promise<void> {
    const jsonExit = (error as CommandError & Partial<OclifError>).oclif?.exit
    if (this.jsonEnabled() && jsonExit !== undefined) process.exitCode = jsonExit
    await super.catch(error)
  }

  public async run(): Promise<ITranslateOutput | void> {
    const {args, flags} = await this.parse(Translate)

    let batchConfig: ReturnType<typeof resolveTranslationBatchConfig>
    let projectService: TranslationProjectService | undefined
    let requests: ITranslationRequestPlan[]
    let translationService: TranslationService

    try {
      await this.readCliConfig()
      const from = flags.from ?? this.cliConfig.langCodeDefault
      this.validateFlags({
        confirm: flags.confirm,
        dryRun: flags['dry-run'],
        from,
        keys: flags.key,
        stdin: flags.stdin,
        targets: flags.to,
        text: args.text,
        write: flags.write,
      })
      batchConfig = this.resolveBatchConfig({
        concurrency: flags.concurrency,
        delayMs: flags['delay-ms'],
        maxChars: flags['max-chars'],
        maxItems: flags['max-items'],
        retry: flags.retry,
      })

      translationService = TranslationService.fromConfig(
        this.cliConfig,
        {
          cacheFile: path.join(this.config.cacheDir, CTV_TRANSLATION_CACHE_FILE),
          ...(flags['no-fallback']
            ? {fallback: null}
            : flags.fallback === undefined ? {} : {fallback: flags.fallback}),
          selectedEngine: flags.engine,
        },
      )

      if (flags.key?.length) {
        projectService = TranslationProjectService.load(this.cliConfig)
        requests = await projectService.planKeys(flags.key, from, flags.to)
      } else {
        const sourceText = flags.stdin ? await this.readStdin() : args.text
        if (sourceText === undefined) {
          throw new Error('Source text is required.')
        }

        requests = flags.to.map(to => ({from, sourceText, to}))
      }
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    try {
      const executed = await new TranslationBatchService(translationService).execute(requests, {
        config: batchConfig,
        dryRun: flags['dry-run'],
      })
      const batch = flags.confirm ? await this.confirmResults(executed) : executed

      if (flags.write && !projectService) {
        throw new Error('Write mode requires a loaded translation project.')
      }

      const written = flags.write && batch.results.length > 0
        ? await projectService.write(batch.results)
        : []
      const output: ITranslateOutput = {
        ...batch,
        dryRun: flags['dry-run'],
        requests,
        written,
      }
      const rendered = this.output(output)
      if (output.summary.failed > 0 || output.summary.conflict > 0) process.exitCode = 1
      return rendered
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 1})
    }
  }

  private async confirmResults(batch: ITranslationBatchOutput): Promise<ITranslationBatchOutput> {
    const results: ITranslationResult[] = []
    const skipped: ITranslationSkipped[] = [...batch.skipped]

    for (const result of batch.results) {
      const decision = await select<'accept' | 'skip'>({
        choices: [
          {name: 'accept', value: 'accept'},
          {name: 'skip', value: 'skip'},
        ],
        message: `${result.key ? `${result.key} -> ` : ''}${result.to}: ${result.translatedText}`,
      }, {output: this.jsonEnabled() ? process.stderr : process.stdout})

      if (decision === 'accept') results.push(result)
      else {
        const request: ITranslationRequestPlan = {
          from: result.from,
          ...(result.key ? {key: result.key} : {}),
          sourceText: result.sourceText,
          to: result.to,
        }
        skipped.push({reason: 'confirmation', request, result})
      }
    }

    const outcomes = {
      conflicts: batch.conflicts,
      failed: batch.failed,
      remaining: batch.remaining,
      results,
      skipped,
    }
    return {...outcomes, summary: summarizeTranslationBatch(outcomes)}
  }

  private engineSummary(result: ITranslateOutput['results'][number]): string {
    const fallback = result.fallback ? `, fallback from ${result.fallback.from}` : ''
    return `[${result.engine}/${result.provider}/${result.model}${fallback}${result.cached ? ', cached' : ''}]`
  }

  private errorMessage(error: unknown): string {
    if (error instanceof TranslationError) return `[${error.category}] ${error.message}`
    return error instanceof Error ? error.message : String(error)
  }

  private output(output: ITranslateOutput): ITranslateOutput | void {
    if (this.jsonEnabled()) return output

    if (output.results.length === 1) {
      const result = output.results[0]
      this.log(result.translatedText)
      this.log(this.engineSummary(result))
    } else {
      for (const result of output.results) {
        this.log(`${this.requestLabel(result)}: ${result.translatedText} ${this.engineSummary(result)}`)
      }
    }

    for (const skipped of output.skipped) {
      this.log(`Skipped (${skipped.reason}): ${this.requestLabel(skipped.request)}: ${skipped.request.sourceText}`)
    }

    for (const conflict of output.conflicts) {
      this.log(`Conflict: ${this.requestLabel(conflict.request)} (source: ${conflict.sourcePlaceholders.join(', ') || 'none'}; translated: ${conflict.translatedPlaceholders.join(', ') || 'none'})`)
    }

    for (const failed of output.failed) {
      this.log(`Failed: ${this.requestLabel(failed.request)} [${failed.category}] after ${failed.attempts} attempt(s): ${failed.message}`)
    }

    for (const remaining of output.remaining) {
      this.log(`Remaining (${remaining.reason}): ${this.requestLabel(remaining.request)}: ${remaining.request.sourceText}`)
    }

    if (output.written.length > 0) this.log(`Written: ${output.written.join(', ')}`)
    this.log(`Summary: translated=${output.summary.translated}, cached=${output.summary.cached}, skipped=${output.summary.skipped}, conflict=${output.summary.conflict}, failed=${output.summary.failed}, remaining=${output.summary.remaining}`)
  }

  private async readStdin(): Promise<string> {
    process.stdin.setEncoding('utf8')
    let contents = ''
    for await (const chunk of process.stdin) contents += chunk
    return contents
  }

  private requestLabel(request: ITranslationRequestPlan): string {
    return `${request.key ? `${request.key} -> ` : ''}${request.from} -> ${request.to}`
  }

  private resolveBatchConfig(flags: IBatchFlagOverrides): ReturnType<typeof resolveTranslationBatchConfig> {
    return resolveTranslationBatchConfig(this.cliConfig.batch, {
      ...(flags.concurrency === undefined ? {} : {concurrency: flags.concurrency}),
      ...(flags.delayMs === undefined ? {} : {delayMs: flags.delayMs}),
      ...(flags.maxChars === undefined ? {} : {maxChars: flags.maxChars}),
      ...(flags.maxItems === undefined ? {} : {maxItems: flags.maxItems}),
      ...(flags.retry === undefined ? {} : {retry: flags.retry}),
    })
  }

  private validateFlags({
    confirm,
    dryRun,
    from,
    keys,
    stdin,
    targets,
    text,
    write,
  }: ITranslateFlagInput): void {
    const keyMode = Boolean(keys?.length)
    const inputModes = Number(text !== undefined) + Number(Boolean(stdin)) + Number(keyMode)
    if (inputModes !== 1) {
      throw new Error('Choose exactly one input: positional text, --stdin, or one or more --key flags.')
    }

    if (confirm && !write) throw new Error('--confirm is available only with --write.')
    if (write && !keyMode) throw new Error('--write is available only with --key.')
    if (write && dryRun) throw new Error('--write cannot be combined with --dry-run.')
    if (confirm && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('--confirm requires a TTY.')
    if (new Set(targets).size !== targets.length) {
      throw new Error('Target languages must not contain duplicates.')
    }

    validateLanguageCodes([from])
    for (const target of targets) {
      validateLanguageCodes([target])
      if (target === from) throw new Error(`Target language "${target}" must differ from source.`)
    }
  }
}
