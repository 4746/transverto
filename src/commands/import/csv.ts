import type {CommandError, OclifError} from '@oclif/core/interfaces'

import {confirm} from '@inquirer/prompts'
import {Args, Flags} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'

import type {
  ICsvImportPlan,
  ICsvImportProjectSnapshot,
  ICsvImportReport,
  TCsvEmptyPolicy,
  TCsvExistingPolicy,
  TCsvUnknownKeyPolicy,
} from '../../shared/entities/csv-import.js'
import type {IStatusReport} from '../../shared/entities/status.js'

import {CsvImportExecutor} from '../../shared/csv-import-executor.js'
import {CsvImportPlanner} from '../../shared/csv-import-planner.js'
import {buildCsvImportReport, formatCsvImportReport} from '../../shared/csv-import-report.js'
import {parseCsv} from '../../shared/csv-parser.js'
import {
  CSV_EMPTY_POLICIES,
  CSV_EXISTING_POLICIES,
  CSV_UNKNOWN_KEY_POLICIES,
} from '../../shared/entities/csv-import.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LabelMutationRepository} from '../../shared/label-mutation.repository.js'
import {StatusService} from '../../shared/status.service.js'

export default class ImportCsv extends LabelBaseCommand<typeof ImportCsv> {
  static args = {
    file: Args.string({description: 'CSV file created by export:csv', required: true}),
  }

  static description = 'Safely import translations from CSV'
  static enableJsonFlag = true
  static examples = [
    '<%= config.bin %> <%= command.id %> translations.csv --use-new-columns --dry-run',
    '<%= config.bin %> <%= command.id %> translations.csv --map translated_uk=uk --write',
    '<%= config.bin %> <%= command.id %> translations.csv --existing overwrite --empty clear --write',
  ]

  static flags = {
    delimiter: Flags.string({char: 'd', default: ',', description: 'single CSV delimiter character'}),
    'dry-run': Flags.boolean({description: 'show the import plan without writing files'}),
    empty: Flags.string({
      default: 'skip',
      description: 'policy for empty regular cells',
      options: [...CSV_EMPTY_POLICIES],
    }),
    existing: Flags.string({
      default: 'conflict',
      description: 'policy when an imported value differs from an existing translation',
      options: [...CSV_EXISTING_POLICIES],
    }),
    map: Flags.string({description: 'map a CSV column to a language as column=language', multiple: true}),
    'unknown-key': Flags.string({
      default: 'conflict',
      description: 'policy for labels absent from the source dictionary',
      options: [...CSV_UNKNOWN_KEY_POLICIES],
    }),
    'use-new-columns': Flags.boolean({description: 'auto-map *_new columns and ignore their empty cells'}),
    write: Flags.boolean({description: 'apply the plan without interactive confirmation'}),
  }

  protected async catch(error: CommandError): Promise<void> {
    const jsonExit = (error as CommandError & Partial<OclifError>).oclif?.exit
    await super.catch(error)
    if (jsonExit !== undefined) process.exitCode = jsonExit
  }

  public async run(): Promise<ICsvImportReport | void> {
    const {args, flags} = await this.parse(ImportCsv)
    let plan: ICsvImportPlan
    let snapshot: ICsvImportProjectSnapshot
    const file = path.resolve(args.file)

    try {
      this.validateFlags(flags['dry-run'], flags.write)
      await this.readCliConfig()
      snapshot = await LabelMutationRepository.load(this.cliConfig)
      const contents = await fs.promises.readFile(file, 'utf8')
      plan = CsvImportPlanner.create(parseCsv(contents, flags.delimiter), snapshot, {
        empty: flags.empty as TCsvEmptyPolicy,
        existing: flags.existing as TCsvExistingPolicy,
        file,
        mappings: flags.map,
        unknownKey: flags['unknown-key'] as TCsvUnknownKeyPolicy,
        useNewColumns: flags['use-new-columns'],
      })
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    const hasConflicts = plan.actions.some(item => item.type === 'conflict')
    const changeCount = plan.actions.filter(item => item.type === 'add' || item.type === 'update').length
    let confirmed = flags.write
    let previewRendered = false
    let status: IStatusReport | null = null
    let written: string[] = []

    if (!flags['dry-run'] && !flags.write && !hasConflicts && changeCount > 0) {
      if (this.jsonEnabled() || !process.stdin.isTTY || !process.stdout.isTTY) {
        this.error('Non-interactive CSV import requires --write or --dry-run.', {exit: 2})
      }

      this.printReport(buildCsvImportReport({
        confirmed: false,
        dryRun: false,
        plan,
        writeRequested: false,
      }))
      previewRendered = true
      confirmed = await confirm(
        {default: false, message: `Apply ${changeCount} CSV changes?`},
        {output: process.stdout},
      )
    }

    if (!flags['dry-run'] && confirmed && !hasConflicts && changeCount > 0) {
      try {
        written = await CsvImportExecutor.apply(plan, snapshot)
        status = await StatusService.analyze({cwd: snapshot.cwd, failOn: 'never'})
      } catch (error) {
        this.error(this.errorMessage(error), {exit: 2})
      }
    }

    const report = buildCsvImportReport({
      confirmed,
      dryRun: flags['dry-run'],
      plan,
      status,
      writeRequested: flags.write,
      written,
    })
    if (report.exitCode === 1) process.exitCode = 1
    if (this.jsonEnabled()) return report
    if (!previewRendered) this.printReport(report)
    else if (written.length > 0) this.log(`Written: ${written.join(', ')}`)
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private printReport(report: ICsvImportReport): void {
    for (const line of formatCsvImportReport(report)) this.log(line)
  }

  private validateFlags(dryRun: boolean, write: boolean): void {
    if (dryRun && write) throw new Error('--dry-run cannot be combined with --write.')
  }
}
