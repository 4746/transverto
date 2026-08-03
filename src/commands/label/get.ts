import type {CommandError, OclifError} from '@oclif/core/interfaces'

import {input} from '@inquirer/prompts'
import {Args, Flags} from '@oclif/core'
import {printTable} from '@oclif/table'
import chalk from 'chalk'

import type {
  ILabelSearchReport,
  TLabelSearchMode,
} from '../../shared/entities/label-search.js'

import {LABEL_SEARCH_MODES} from '../../shared/entities/label-search.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LabelSearchService} from '../../shared/label-search.service.js'

export default class LabelGet extends LabelBaseCommand<typeof LabelGet> {
  static args = {
    query: Args.string({description: 'key or translation text to search for'}),
  }

  static description = 'Search translation keys and values across configured languages'
  static enableJsonFlag = true
  static examples = [
    '<%= config.bin %> <%= command.id %> home.title --mode exact',
    '<%= config.bin %> <%= command.id %> home --mode prefix --language en --language uk',
    '<%= config.bin %> <%= command.id %> "*.title" --mode glob --ignore-case --json',
    '<%= config.bin %> <%= command.id %> welcome --mode text --compact',
    '<%= config.bin %> <%= command.id %> home --mode prefix --limit 10',
  ]

  static flags = {
    compact: Flags.boolean({description: 'show one row per key with language columns'}),
    'ignore-case': Flags.boolean({description: 'match keys or values without case sensitivity'}),
    language: Flags.string({description: 'language code to search', multiple: true}),
    limit: Flags.integer({description: 'maximum number of sorted keys to return'}),
    mode: Flags.string({
      default: 'prefix',
      description: 'search mode',
      options: [...LABEL_SEARCH_MODES],
    }),
  }

  protected async catch(error: CommandError): Promise<void> {
    const jsonExit = (error as CommandError & Partial<OclifError>).oclif?.exit
    await super.catch(error)
    if (jsonExit !== undefined) process.exitCode = jsonExit
  }

  public async run(): Promise<ILabelSearchReport | void> {
    const {args, flags} = await this.parse(LabelGet)
    let {query} = args

    if (!query) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        this.error('Missing search query. Pass QUERY when running non-interactively.', {exit: 2})
      }

      query = await input({message: 'Search query:'}, {output: process.stdout})
    }

    let report: ILabelSearchReport
    try {
      await this.readCliConfig()
      report = await LabelSearchService.search(this.cliConfig, {
        ignoreCase: flags['ignore-case'],
        languages: flags.language,
        limit: flags.limit,
        mode: flags.mode as TLabelSearchMode,
        query,
      })
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }

    if (this.jsonEnabled()) return report
    if (flags.compact) this.printCompact(report)
    else this.printExpanded(report)
    this.printSummary(report)
  }

  private printCompact(report: ILabelSearchReport): void {
    const columns = [
      {key: 'key', name: 'Key'},
      ...report.languages.map(language => ({key: language, name: language})),
    ]
    const data = report.results.map(result => ({
      key: chalk.green(result.key),
      ...Object.fromEntries(result.translations.map(translation => [
        translation.language,
        translation.value === null ? chalk.dim('—') : chalk.cyan(translation.value),
      ])),
    }))

    printTable<Record<string, string>>({columns, data, maxWidth: 'none', overflow: 'wrap'})
  }

  private printExpanded(report: ILabelSearchReport): void {
    const data = report.results.flatMap(result => result.translations.map(translation => ({
      key: chalk.green(result.key),
      language: chalk.yellow(translation.language),
      value: translation.value === null ? chalk.dim('—') : chalk.cyan(translation.value),
    })))

    printTable({
      columns: [
        {key: 'key', name: 'Key'},
        {key: 'language', name: 'Language'},
        {key: 'value', name: 'Translation'},
      ],
      data,
      maxWidth: 'none',
      overflow: 'wrap',
    })
  }

  private printSummary(report: ILabelSearchReport): void {
    this.log('')
    this.log(`Mode: ${report.mode}`)
    this.log(`Languages: ${report.languages.join(', ')}`)
    this.log(`Results: ${report.results.length} of ${report.total}${report.truncated ? ' (truncated)' : ''}`)
  }
}
