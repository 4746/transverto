import {Args, Flags} from '@oclif/core'
import chalk from "chalk";
import path from 'node:path'

import type {
  ITranslationBatchOutput,
  ITranslationFailed,
} from '../../shared/entities/translation-batch.js'
import type {ILabelAddConflict} from '../../shared/entities/label-add.js'

import {CTV_TRANSLATION_CACHE_FILE} from '../../shared/constants.js'
import {LabelAddExecutor} from '../../shared/label-add-executor.js'
import {inspectLabelAddKey, LabelAddPlanner} from '../../shared/label-add-planner.js'
import {confirmLabelAddOverwrite} from '../../shared/label-add-overwrite.prompt.js'
import {LabelAddRepository} from '../../shared/label-add.repository.js'
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {resolveTranslationBatchConfig} from '../../shared/translation-batch.config.js'
import {TranslationBatchService} from '../../shared/translation-batch.service.js'
import {createIncompleteDecisionHandler} from '../../shared/translation-incomplete.prompt.js'
import {TranslationService} from '../../shared/translation.service.js'

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add hello.world  -f="en"
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add hello.world  -f="en" -t "Hello World!"
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add "ggggg"
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add "ggggg" -fen
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add "\"ggggg\"" -fen
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add \"ggggg\" -fen
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add '"ggggg"' -fen
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add \&quot;ggggg\&quot; -fen
 * "C:\Program Files\nodejs\npm.cmd" run ctv label:add "\"ggggg\"" -fen
 */
export default class LabelAdd extends LabelBaseCommand<typeof LabelAdd> {
  static args = {
    label: Args.string({default: null,  description: 'A label key', requiredOrDefaulted: true}),
  }

  static description = 'Add a new label';

  static examples = [
    `<%= config.bin %> <%= command.id %> "hello.world" -f="en"`,
    `<%= config.bin %> <%= command.id %> "hello.world" -f en -t "Hello World!"`,
    `<%= config.bin %> <%= command.id %> "hello.world" -fen -t "Hello World!"`,
    `<%= config.bin %> <%= command.id %> "hello.world" -t "Hello World!"`,
  ]

  static flags = {
    fromLangCode: Flags.string({
      char: 'f',
      default: null,
      description: 'The language code of source text.',
      multiple: false,
      requiredOrDefaulted: true,
    }),
    noAutoTranslate: Flags.boolean({aliases: ['no-auto-translate'], default: false}),
    silent: Flags.boolean({default: false}),
    translation: Flags.string({
      char: "t",
      default: null,
      description: 'Translation',
      multiple: false,
      requiredOrDefaulted: true,
    }),
  }

  /**
   * The language code of source text.
   */
  private fromLangCode: string;
  private label: string;
  private noAutoTranslate: boolean;
  private silent: boolean;
  private translation: string;

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LabelAdd);

    this.noAutoTranslate = flags.noAutoTranslate;
    this.silent = flags.silent;

    await this.readCliConfig();

    this.label = await this.getLabelValidationOrInput({
      label: args.label || null,
      labelValidation: this.cliConfig.labelValidation
    });

    if (!this.silent) {
      this.log(chalk.green(`Enter label:`), this.label);
    }

    this.fromLangCode = await this.getLangCode(this.cliConfig.languages, flags.fromLangCode, this.cliConfig.langCodeDefault);

    if (!this.silent) {
      this.log(chalk.green(`Enter language:`), this.fromLangCode);
    }

    let plan
    let snapshot
    try {
      snapshot = await LabelAddRepository.load(this.cliConfig)
      const inspection = inspectLabelAddKey(snapshot, this.label)
      if (inspection.conflicts.length > 0) {
        throw new Error(this.pathConflictMessage(inspection.conflicts))
      }

      if (inspection.existing.length > 0) {
        const accepted = await confirmLabelAddOverwrite({
          interactive: !this.silent && Boolean(process.stdin.isTTY && process.stdout.isTTY),
          key: this.label,
          output: process.stdout,
        })
        if (!accepted) return
      }

      this.translation = await this.getTranslation(flags.translation, this.fromLangCode)

      if (!this.silent) {
        this.log(chalk.green(`Enter translation:`), this.translation)
      }

      plan = LabelAddPlanner.create(snapshot, {
        autoTranslate: !this.noAutoTranslate,
        key: this.label,
        source: this.fromLangCode,
        sourceText: this.translation,
      })
      if (plan.conflicts.length > 0) {
        throw new Error(this.pathConflictMessage(plan.conflicts))
      }
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    let batch: ITranslationBatchOutput | null = null
    let translationService: TranslationService | undefined
    try {
      if (plan.requests.length > 0) {
        translationService = TranslationService.fromConfig(this.cliConfig, {
          cacheFile: path.join(this.config.cacheDir, CTV_TRANSLATION_CACHE_FILE),
          deferCacheWrites: true,
        })
        const executor = {
          translate: translationService.translate.bind(translationService),
          translateBatch: translationService.translateBatch.bind(translationService),
        }
        const onIncomplete = createIncompleteDecisionHandler({
          interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
          output: process.stdout,
        })
        batch = await new TranslationBatchService(executor).execute(plan.requests, {
          config: resolveTranslationBatchConfig(this.cliConfig.batch),
          dryRun: false,
          ...(onIncomplete ? {onIncomplete} : {}),
        })
      }

      await LabelAddExecutor.apply({batch, plan, snapshot})
    } catch (error) {
      const message = batch?.failed.length
        ? this.translationFailureMessage(batch.failed)
        : this.errorMessage(error)
      this.logToStderr(message)
      process.exitCode = 1
      return
    }

    if (translationService && batch) {
      try {
        await translationService.cacheResults(batch.results)
      } catch (error) {
        this.warn(`Label was added, but translations could not be cached: ${this.errorMessage(error)}`)
      }
    }

    this.log(chalk.cyan(`Done!`));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private pathConflictMessage(conflicts: readonly ILabelAddConflict[]): string {
    return conflicts
      .map(conflict => `Translation key "${conflict.key}" has a path conflict in ${conflict.language}.`)
      .join(' ')
  }

  private translationFailureMessage(failures: ITranslationFailed[]): string {
    return [
      'Translation failed; label was not added:',
      ...failures.map(failed => {
        const attempts = `${failed.attempts} ${failed.attempts === 1 ? 'attempt' : 'attempts'}`
        return `- ${failed.request.to} [${failed.category}] after ${attempts}: ${failed.message}`
      }),
    ].join('\n')
  }
}
