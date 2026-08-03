import type {CommandError, OclifError} from '@oclif/core/interfaces'

import {confirm} from '@inquirer/prompts'
import {Flags} from '@oclif/core'
import path from 'node:path'

import type {ISyncPlan, ISyncProjectSnapshot, ISyncReport, TSyncExtraPolicy} from '../../shared/entities/sync.js'
import type {ITranslationBatchOutput} from '../../shared/entities/translation-batch.js'

import {CTV_TRANSLATION_CACHE_FILE} from '../../shared/constants.js'
import {
  resolveEngineProfile,
  validateEngineConfiguration,
  validateFallbackConfiguration,
} from '../../shared/engine-profile.js'
import {SYNC_EXTRA_POLICIES} from '../../shared/entities/sync.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {SyncExecutor} from '../../shared/sync-executor.js'
import {SyncPlanner, syncTranslationRequests} from '../../shared/sync-planner.js'
import {buildSyncReport, formatSyncReport} from '../../shared/sync-report.js'
import {SyncRepository} from '../../shared/sync.repository.js'
import {resolveTranslationBatchConfig} from '../../shared/translation-batch.config.js'
import {TranslationBatchService} from '../../shared/translation-batch.service.js'
import {TranslationService} from '../../shared/translation.service.js'

interface ISyncEngineFlags {
  engine?: string
  fallback?: string
  noFallback: boolean
}

export default class LabelSync extends LabelBaseCommand<typeof LabelSync> {
  static description = 'Safely synchronize configured translation dictionaries'

  static enableJsonFlag = true

  static examples = [
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --source en --to uk --to de --dry-run --json',
    '<%= config.bin %> <%= command.id %> --include "home.*" --extra remove --write',
    '<%= config.bin %> <%= command.id %> --auto-translate --engine lmstudio --write',
    '<%= config.bin %> <%= command.id %> --auto-translate --no-fallback --dry-run',
  ]

  static flags = {
    'auto-translate': Flags.boolean({
      default: false,
      description: 'translate missing values through the configured batch pipeline',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'show the immutable plan without network calls or writes',
    }),
    engine: Flags.string({description: 'named engine profile for auto-translation'}),
    exclude: Flags.string({
      description: 'exclude exact or edge-wildcard key pattern',
      multiple: true,
    }),
    extra: Flags.string({
      default: 'report',
      description: 'policy for target keys absent from the source',
      options: [...SYNC_EXTRA_POLICIES],
    }),
    fallback: Flags.string({
      description: 'single fallback engine profile for auto-translation',
      exclusive: ['no-fallback'],
    }),
    include: Flags.string({
      description: 'include exact or edge-wildcard key pattern',
      multiple: true,
    }),
    'no-fallback': Flags.boolean({
      default: false,
      description: 'disable configured fallback for auto-translation',
    }),
    source: Flags.string({description: 'source language code'}),
    to: Flags.string({description: 'target language code', multiple: true}),
    write: Flags.boolean({
      default: false,
      description: 'apply the plan without interactive confirmation',
    }),
  }

  protected async catch(error: CommandError): Promise<void> {
    const jsonExit = (error as CommandError & Partial<OclifError>).oclif?.exit
    await super.catch(error)
    if (jsonExit !== undefined) process.exitCode = jsonExit
  }

  public async run(): Promise<ISyncReport | void> {
    const {flags} = await this.parse(LabelSync)
    let batch: ITranslationBatchOutput | null = null
    let plan: ISyncPlan
    let snapshot: ISyncProjectSnapshot

    try {
      await this.readCliConfig()
      this.validateFlags({
        autoTranslate: flags['auto-translate'],
        dryRun: flags['dry-run'],
        engine: flags.engine,
        fallback: flags.fallback,
        noFallback: flags['no-fallback'],
        write: flags.write,
      })
      const batchConfig = resolveTranslationBatchConfig(this.cliConfig.batch)
      snapshot = await SyncRepository.load(this.cliConfig, {
        source: flags.source,
        targets: flags.to,
      })
      plan = SyncPlanner.create(snapshot, {
        autoTranslate: flags['auto-translate'],
        exclude: flags.exclude,
        extra: flags.extra as TSyncExtraPolicy,
        include: flags.include,
      })

      if (flags['auto-translate']) {
        this.validateEngineConfiguration({
          engine: flags.engine,
          fallback: flags.fallback,
          noFallback: flags['no-fallback'],
        })
        const requests = syncTranslationRequests(plan)
        if (flags['dry-run']) {
          const unreachableExecutor = {
            translate: () => Promise.reject(new Error('Dry-run executor must not be called.')),
          }
          batch = await new TranslationBatchService(unreachableExecutor).execute(requests, {
            config: batchConfig,
            dryRun: true,
          })
        } else {
          const translationService = TranslationService.fromConfig(
            this.cliConfig,
            {
              cacheFile: path.join(this.config.cacheDir, CTV_TRANSLATION_CACHE_FILE),
              ...(flags['no-fallback']
                ? {fallback: null}
                : flags.fallback === undefined ? {} : {fallback: flags.fallback}),
              selectedEngine: flags.engine,
            },
          )
          batch = await new TranslationBatchService(translationService).execute(requests, {
            config: batchConfig,
            dryRun: false,
          })
        }
      }
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    let confirmed = flags.write
    let previewRendered = false
    let written: string[] = []
    const hasStructuralConflict = plan.actions.some(action => action.type === 'conflict')

    if (!flags['dry-run'] && !flags.write && !hasStructuralConflict) {
      const preview = buildSyncReport({
        batch,
        confirmed: false,
        dryRun: false,
        plan,
        writeRequested: false,
      })
      this.printHumanReport(preview)
      previewRendered = true
      confirmed = await confirm(
        {default: false, message: 'Apply this synchronization plan?'},
        {output: process.stdout},
      )
    }

    if (!flags['dry-run'] && confirmed && !hasStructuralConflict) {
      try {
        written = await SyncExecutor.apply({batch, plan, snapshot})
      } catch (error) {
        this.error(this.errorMessage(error), {exit: 2})
      }
    }

    const report = buildSyncReport({
      batch,
      confirmed,
      dryRun: flags['dry-run'],
      plan,
      writeRequested: flags.write,
      written,
    })
    if (report.exitCode === 1) process.exitCode = 1

    if (this.jsonEnabled()) return report
    if (!previewRendered) this.printHumanReport(report)
    else if (written.length > 0) this.log(`Written: ${written.join(', ')}`)
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private printHumanReport(report: ISyncReport): void {
    for (const line of formatSyncReport(report)) this.log(line)
  }

  private validateEngineConfiguration(flags: ISyncEngineFlags): void {
    const primary = resolveEngineProfile(
      this.cliConfig,
      flags.engine,
      process.env,
      {requireCredentials: false},
    )
    const engines = validateEngineConfiguration(this.cliConfig.engine, this.cliConfig.engines)
    const fallback = flags.noFallback
      ? null
      : flags.fallback === undefined ? this.cliConfig.fallback : flags.fallback
    validateFallbackConfiguration(fallback, engines, primary.name)
  }

  private validateFlags(flags: {
    autoTranslate: boolean
    dryRun: boolean
    engine?: string
    fallback?: string
    noFallback: boolean
    write: boolean
  }): void {
    if (flags.dryRun && flags.write) throw new Error('--dry-run cannot be combined with --write.')
    if (!flags.autoTranslate && (flags.engine || flags.fallback || flags.noFallback)) {
      throw new Error('--engine, --fallback, and --no-fallback require --auto-translate.')
    }

    if (!flags.dryRun && !flags.write && (
      this.jsonEnabled() ||
      !process.stdin.isTTY ||
      !process.stdout.isTTY
    )) {
      throw new Error('Non-interactive synchronization requires --write or --dry-run.')
    }
  }
}
