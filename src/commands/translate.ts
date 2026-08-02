import {Args, Flags} from '@oclif/core'
import path from 'node:path'

import {validateLanguageCodes} from '../shared/config-builder.js'
import {CTV_TRANSLATION_CACHE_FILE} from '../shared/constants.js'
import {TranslationError} from '../shared/entities/translation-error.js'
import {
  ITranslateOutput,
  ITranslationRequestPlan,
  ITranslationResult,
} from '../shared/entities/translation.engine.js'
import {LabelBaseCommand} from '../shared/label-base.command.js'
import {TranslationProjectService} from '../shared/translation-project.service.js'
import {TranslationService} from '../shared/translation.service.js'

interface ITranslateFlagInput {
  dryRun: boolean
  from: string
  keys?: string[]
  stdin: boolean
  targets: string[]
  text?: string
  write: boolean
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
  ]

  static flags = {
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
    'no-fallback': Flags.boolean({description: 'disable the configured fallback for this run'}),
    stdin: Flags.boolean({description: 'read source text from stdin'}),
    to: Flags.string({description: 'target language code', multiple: true, required: true}),
    write: Flags.boolean({description: 'write key translations to target dictionaries'}),
  }

  public async run(): Promise<ITranslateOutput | void> {
    const {args, flags} = await this.parse(Translate)

    let projectService: TranslationProjectService | undefined
    let requests: ITranslationRequestPlan[]
    let translationService: TranslationService

    try {
      await this.readCliConfig()
      const from = flags.from ?? this.cliConfig.langCodeDefault
      this.validateFlags({
        dryRun: flags['dry-run'],
        from,
        keys: flags.key,
        stdin: flags.stdin,
        targets: flags.to,
        text: args.text,
        write: flags.write,
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
        if (!sourceText || sourceText.trim().length === 0) {
          throw new Error('Source text must not be empty.')
        }

        requests = flags.to.map(to => ({from, sourceText, to}))
      }

      if (flags['dry-run']) {
        const output: ITranslateOutput = {
          conflicts: [],
          dryRun: true,
          failed: [],
          remaining: requests.map(request => ({reason: 'dry_run', request})),
          requests,
          results: [],
          skipped: [],
          summary: {
            cached: 0,
            conflict: 0,
            failed: 0,
            remaining: requests.length,
            skipped: 0,
            translated: 0,
          },
          written: [],
        }
        return this.output(output)
      }
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    try {
      const results: ITranslationResult[] = []
      for (const request of requests) results.push(await translationService.translate(request))

      const written = flags.write ? await projectService.write(results) : []
      return this.output({
        conflicts: [],
        dryRun: false,
        failed: [],
        remaining: [],
        requests,
        results,
        skipped: [],
        summary: {
          cached: results.filter(result => result.cached).length,
          conflict: 0,
          failed: 0,
          remaining: 0,
          skipped: 0,
          translated: results.filter(result => !result.cached).length,
        },
        written,
      })
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 1})
    }
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

    if (output.dryRun) {
      for (const request of output.requests) {
        this.log(`${request.key ? `${request.key} -> ` : ''}${request.from} -> ${request.to}: ${request.sourceText}`)
      }

      return
    }

    if (output.results.length === 1) {
      const result = output.results[0]
      this.log(result.translatedText)
      this.log(this.engineSummary(result))
    } else {
      for (const result of output.results) {
        this.log(`${result.key ? `${result.key} -> ` : ''}${result.to}: ${result.translatedText} ${this.engineSummary(result)}`)
      }
    }

    if (output.written.length > 0) this.log(`Written: ${output.written.join(', ')}`)
  }

  private async readStdin(): Promise<string> {
    process.stdin.setEncoding('utf8')
    let contents = ''
    for await (const chunk of process.stdin) contents += chunk
    return contents
  }

  private validateFlags({dryRun, from, keys, stdin, targets, text, write}: ITranslateFlagInput): void {
    const keyMode = Boolean(keys?.length)
    const inputModes = Number(text !== undefined) + Number(Boolean(stdin)) + Number(keyMode)
    if (inputModes !== 1) {
      throw new Error('Choose exactly one input: positional text, --stdin, or one or more --key flags.')
    }

    if (write && !keyMode) throw new Error('--write is available only with --key.')
    if (write && dryRun) throw new Error('--write cannot be combined with --dry-run.')
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
