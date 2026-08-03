import type {CommandError, OclifError} from '@oclif/core/interfaces'

import {confirm} from '@inquirer/prompts'
import {Flags} from '@oclif/core'

import type {
  ILabelMutationReport,
  TLabelMutationOperation,
} from './entities/label-mutation.js'

import {LabelBaseCommand} from './label-base.command.js'
import {LabelMutationExecutor} from './label-mutation-executor.js'
import {LabelMutationPlanner} from './label-mutation-planner.js'
import {buildLabelMutationReport, formatLabelMutationReport} from './label-mutation-report.js'
import {LabelMutationRepository} from './label-mutation.repository.js'

export const labelMutationFlags = {
  'dry-run': Flags.boolean({description: 'show the immutable plan without writing files'}),
  exclude: Flags.string({
    description: 'exclude exact or edge-wildcard source key pattern',
    multiple: true,
  }),
  include: Flags.string({
    description: 'include exact or edge-wildcard source key pattern',
    multiple: true,
  }),
  language: Flags.string({description: 'language code to mutate', multiple: true}),
  write: Flags.boolean({description: 'apply the plan without interactive confirmation'}),
}

export interface IRunLabelMutationInput {
  dryRun: boolean
  exclude?: string[]
  force?: boolean
  include?: string[]
  languages?: string[]
  newPath?: string
  oldPath: string
  operation: TLabelMutationOperation
  overwrite?: boolean
  write: boolean
}

export abstract class LabelMutationCommand<T extends typeof LabelMutationCommand> extends LabelBaseCommand<T> {
  protected async catch(error: CommandError): Promise<void> {
    const jsonExit = (error as CommandError & Partial<OclifError>).oclif?.exit
    await super.catch(error)
    if (jsonExit !== undefined) process.exitCode = jsonExit
  }

  protected async runLabelMutation(input: IRunLabelMutationInput): Promise<ILabelMutationReport | void> {
    let plan
    let snapshot
    try {
      this.validateMutationFlags(input)
      await this.readCliConfig()
      snapshot = await LabelMutationRepository.load(this.cliConfig, {languages: input.languages})
      plan = LabelMutationPlanner.create(snapshot, {
        exclude: input.exclude,
        include: input.include,
        newPath: input.newPath,
        oldPath: input.oldPath,
        operation: input.operation,
        overwrite: input.overwrite,
      })
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    const writeRequested = input.write || Boolean(input.force)
    const hasConflicts = plan.conflicts.length > 0
    let confirmed = writeRequested
    let previewRendered = false
    let written: string[] = []

    if (!input.dryRun && !writeRequested && !hasConflicts && plan.changes.length > 0) {
      if (this.jsonEnabled() || !process.stdin.isTTY || !process.stdout.isTTY) {
        this.error('Non-interactive mutation requires --write, --force, or --dry-run.', {exit: 2})
      }

      const preview = buildLabelMutationReport({
        confirmed: false,
        dryRun: false,
        plan,
        writeRequested: false,
      })
      this.printMutationReport(preview)
      previewRendered = true
      confirmed = await confirm(
        {default: false, message: `Apply ${plan.operation} to ${plan.changes.length} language/key entries?`},
        {output: process.stdout},
      )
    }

    if (!input.dryRun && confirmed && !hasConflicts && plan.changes.length > 0) {
      try {
        written = await LabelMutationExecutor.apply(plan, snapshot)
      } catch (error) {
        this.error(this.errorMessage(error), {exit: 2})
      }
    }

    const report = buildLabelMutationReport({
      confirmed,
      dryRun: input.dryRun,
      plan,
      writeRequested,
      written,
    })
    if (report.exitCode === 1) process.exitCode = 1
    if (this.jsonEnabled()) return report
    if (!previewRendered) this.printMutationReport(report)
    else if (written.length > 0) this.log(`Written: ${written.join(', ')}`)
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private printMutationReport(report: ILabelMutationReport): void {
    for (const line of formatLabelMutationReport(report)) this.log(line)
  }

  private validateMutationFlags(input: IRunLabelMutationInput): void {
    if (input.dryRun && (input.write || input.force)) {
      throw new Error('--dry-run cannot be combined with --write or --force.')
    }
  }
}
