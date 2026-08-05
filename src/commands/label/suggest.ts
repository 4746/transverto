import type {CommandError, OclifError} from '@oclif/core/interfaces'

import {Args, Flags} from '@oclif/core'

import type {ILabelSuggestionOutput} from '../../shared/entities/label-suggestion.js'

import {resolveEngineProfile} from '../../shared/engine-profile.js'
import {OpenAICompatibleEngine} from '../../shared/engines/openai-compatible.engine.js'
import {TranslationError} from '../../shared/entities/translation-error.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {resolveLabelSuggestionConfig} from '../../shared/label-suggestion.config.js'
import {LabelSuggestionService} from '../../shared/label-suggestion.service.js'

export default class Suggest extends LabelBaseCommand<typeof Suggest> {
  static args = {
    text: Args.string({
      description: 'text to turn into English label keys',
      required: true,
    }),
  }

  static description = 'Suggest valid English label keys with an AI model'

  static enableJsonFlag = true

  static examples = [
    '<%= config.bin %> <%= command.id %> "Обрати тип QR-коду"',
    '<%= config.bin %> <%= command.id %> "Select QR code type" --count 10',
    '<%= config.bin %> <%= command.id %> "Обрати тип QR-коду" --engine lmstudio --json',
  ]

  static flags = {
    count: Flags.integer({description: 'number of suggestions to request'}),
    engine: Flags.string({description: 'named engine profile'}),
  }

  protected async catch(error: CommandError): Promise<void> {
    const jsonExit = (error as CommandError & Partial<OclifError>).oclif?.exit
    if (this.jsonEnabled() && jsonExit !== undefined) process.exitCode = jsonExit
    await super.catch(error)
  }

  public async run(): Promise<ILabelSuggestionOutput | void> {
    const {args, flags} = await this.parse(Suggest)
    let engine: OpenAICompatibleEngine
    let resolved: ReturnType<typeof resolveLabelSuggestionConfig>

    try {
      await this.readCliConfig()
      resolved = resolveLabelSuggestionConfig(this.cliConfig, flags.count)
      const profile = resolveEngineProfile(this.cliConfig, flags.engine)
      engine = new OpenAICompatibleEngine(profile)
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 2})
    }

    try {
      const result = await new LabelSuggestionService(engine).suggest({
        count: resolved.count,
        labelValidation: resolved.labelValidation,
        text: args.text,
      })
      const output: ILabelSuggestionOutput = {
        ...(resolved.showInvalid
          ? {invalidSuggestions: result.invalidSuggestions}
          : {}),
        suggestions: result.suggestions,
      }

      if (this.jsonEnabled()) return output
      this.render(output)
    } catch (error) {
      this.error(this.errorMessage(error), {exit: 1})
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof TranslationError) return `[${error.category}] ${error.message}`
    return error instanceof Error ? error.message : String(error)
  }

  private render(output: ILabelSuggestionOutput): void {
    for (const suggestion of output.suggestions) this.log(suggestion)

    if (output.invalidSuggestions && output.invalidSuggestions.length > 0) {
      if (output.suggestions.length > 0) this.log('')
      this.log('Invalid suggestions:')
      for (const suggestion of output.invalidSuggestions) this.log(suggestion)
    }
  }
}
