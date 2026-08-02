import {IConfig} from './config.js'
import {resolveEngineProfile} from './engine-profile.js'
import {OpenAICompatibleEngine} from './engines/openai-compatible.engine.js'
import {
  IResolvedEngineProfile,
  ITranslationRequestPlan,
  ITranslationResult,
  TranslationEngine,
} from './entities/translation.engine.js'
import {TranslationCacheService} from './translation-cache.service.js'

export interface ITranslationServiceOptions {
  cacheFile: string
  environment?: NodeJS.ProcessEnv
  selectedEngine?: string
}

export class TranslationService {
  private constructor(
    private readonly profile: IResolvedEngineProfile,
    private readonly engine: TranslationEngine,
    private readonly cache: TranslationCacheService,
  ) {}

  static fromConfig(
    config: IConfig,
    options: ITranslationServiceOptions,
  ): TranslationService {
    const profile = resolveEngineProfile(
      config,
      options.selectedEngine,
      options.environment ?? process.env,
    )
    const cache = new TranslationCacheService(options.cacheFile, config.cache)
    return new TranslationService(profile, new OpenAICompatibleEngine(profile), cache)
  }

  async translate(request: ITranslationRequestPlan): Promise<ITranslationResult> {
    const identity = {
      from: request.from,
      model: this.profile.model,
      profile: this.profile.name,
      sourceText: request.sourceText,
      to: request.to,
    }
    const cachedEntry = await this.cache.get(identity)
    if (cachedEntry) {
      return {
        ...request,
        cached: true,
        engine: this.profile.name,
        model: this.profile.model,
        translatedText: cachedEntry.translatedText,
      }
    }

    const translatedText = (await this.engine.translate(request)).trim()
    if (!translatedText) {
      throw new Error(
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned an empty translation.`,
      )
    }

    await this.cache.set(identity, translatedText)

    return {
      ...request,
      cached: false,
      engine: this.profile.name,
      model: this.profile.model,
      translatedText,
    }
  }
}
