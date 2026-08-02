import {IConfig} from './config.js'
import {resolveEngineProfile} from './engine-profile.js'
import {OpenAICompatibleEngine} from './engines/openai-compatible.engine.js'
import {
  IResolvedEngineProfile,
  ITranslationRequestPlan,
  ITranslationResult,
  TranslationEngine,
} from './entities/translation.engine.js'

export class TranslationService {
  private constructor(
    private readonly profile: IResolvedEngineProfile,
    private readonly engine: TranslationEngine,
  ) {}

  static fromConfig(
    config: IConfig,
    selectedEngine?: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): TranslationService {
    const profile = resolveEngineProfile(config, selectedEngine, environment)
    return new TranslationService(profile, new OpenAICompatibleEngine(profile))
  }

  async translate(request: ITranslationRequestPlan): Promise<ITranslationResult> {
    const translatedText = (await this.engine.translate(request)).trim()
    if (!translatedText) {
      throw new Error(
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned an empty translation.`,
      )
    }

    return {
      ...request,
      engine: this.profile.name,
      model: this.profile.model,
      translatedText,
    }
  }
}
