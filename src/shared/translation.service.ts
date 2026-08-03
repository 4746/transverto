import {IConfig} from './config.js'
import {
  resolveEngineProfile,
  validateEngineConfiguration,
  validateFallbackConfiguration,
} from './engine-profile.js'
import {OpenAICompatibleEngine} from './engines/openai-compatible.engine.js'
import {
  isRecoverableTranslationError,
  toTranslationError,
  TranslationError,
} from './entities/translation-error.js'
import {
  IResolvedEngineProfile,
  ITranslationRequestPlan,
  ITranslationResult,
  TranslationEngine,
} from './entities/translation.engine.js'
import {TranslationCacheService} from './translation-cache.service.js'

interface ITranslationRuntime {
  engine: TranslationEngine
  profile: IResolvedEngineProfile
}

interface ITranslationResultOptions {
  cached: boolean
  fallbackFrom?: string
  translatedText: string
}

export interface ITranslationServiceOptions {
  cacheFile: string
  environment?: NodeJS.ProcessEnv
  fallback?: null | string
  selectedEngine?: string
}

const validateRequest = (request: ITranslationRequestPlan): void => {
  if (!request.from || !request.to) {
    throw new TranslationError('validation', 'Source and target languages are required.')
  }

  if (request.from === request.to) {
    throw new TranslationError('validation', 'Source and target languages must differ.')
  }

  if (!request.sourceText || request.sourceText.trim().length === 0) {
    throw new TranslationError('validation', 'Source text must not be empty.')
  }
}

export class TranslationService {
  private constructor(
    private readonly primary: ITranslationRuntime,
    private readonly fallback: ITranslationRuntime | undefined,
    private readonly cache: TranslationCacheService,
  ) {}

  static fromConfig(
    config: IConfig,
    options: ITranslationServiceOptions,
  ): TranslationService {
    const environment = options.environment ?? process.env

    try {
      const primaryProfile = resolveEngineProfile(
        config,
        options.selectedEngine,
        environment,
        {requireCredentials: false},
      )
      const engines = validateEngineConfiguration(config.engine, config.engines)
      const fallbackSetting = Object.hasOwn(options, 'fallback')
        ? options.fallback
        : config.fallback
      const fallbackName = validateFallbackConfiguration(
        fallbackSetting,
        engines,
        primaryProfile.name,
      )
      const fallbackProfile = fallbackName
        ? resolveEngineProfile(config, fallbackName, environment, {requireCredentials: false})
        : undefined
      const cache = new TranslationCacheService(options.cacheFile, config.cache)

      return new TranslationService(
        {engine: new OpenAICompatibleEngine(primaryProfile), profile: primaryProfile},
        fallbackProfile
          ? {engine: new OpenAICompatibleEngine(fallbackProfile), profile: fallbackProfile}
          : undefined,
        cache,
      )
    } catch (error) {
      throw toTranslationError(error, 'configuration')
    }
  }

  async translate(request: ITranslationRequestPlan): Promise<ITranslationResult> {
    validateRequest(request)

    const primaryCached = await this.getCached(this.primary, request)
    if (primaryCached) return primaryCached

    if (this.fallback) {
      const fallbackCached = await this.getCached(this.fallback, request, this.primary.profile.name)
      if (fallbackCached) return fallbackCached
    }

    try {
      return await this.translateWith(this.primary, request)
    } catch (error) {
      const translationError = toTranslationError(error, 'provider_response', undefined, {
        profile: this.primary.profile,
      })
      if (!this.fallback || !isRecoverableTranslationError(translationError)) {
        throw translationError
      }
    }

    return this.translateWith(this.fallback, request, this.primary.profile.name)
  }

  private async getCached(
    runtime: ITranslationRuntime,
    request: ITranslationRequestPlan,
    fallbackFrom?: string,
  ): Promise<ITranslationResult | undefined> {
    let cachedEntry
    try {
      cachedEntry = await this.cache.get(this.identity(runtime.profile, request))
    } catch (error) {
      throw toTranslationError(error, 'configuration')
    }

    if (!cachedEntry) return
    return this.result(runtime.profile, request, {
      cached: true,
      fallbackFrom,
      translatedText: cachedEntry.translatedText,
    })
  }

  private identity(
    profile: IResolvedEngineProfile,
    request: ITranslationRequestPlan,
  ) {
    return {
      from: request.from,
      model: profile.model,
      profile: profile.name,
      sourceText: request.sourceText,
      to: request.to,
    }
  }

  private result(
    profile: IResolvedEngineProfile,
    request: ITranslationRequestPlan,
    options: ITranslationResultOptions,
  ): ITranslationResult {
    return {
      ...request,
      cached: options.cached,
      engine: profile.name,
      ...(options.fallbackFrom ? {fallback: {from: options.fallbackFrom}} : {}),
      model: profile.model,
      provider: profile.provider,
      translatedText: options.translatedText,
    }
  }

  private async translateWith(
    runtime: ITranslationRuntime,
    request: ITranslationRequestPlan,
    fallbackFrom?: string,
  ): Promise<ITranslationResult> {
    let translatedText: string
    try {
      translatedText = (await runtime.engine.translate(request)).trim()
    } catch (error) {
      throw toTranslationError(error, 'provider_response', undefined, {profile: runtime.profile})
    }

    if (!translatedText) {
      throw new TranslationError(
        'provider_response',
        `Engine profile "${runtime.profile.name}" (${runtime.profile.model}) returned an empty translation.`,
        {profile: runtime.profile},
      )
    }

    try {
      await this.cache.set(this.identity(runtime.profile, request), translatedText)
    } catch (error) {
      throw toTranslationError(error, 'configuration')
    }

    return this.result(runtime.profile, request, {cached: false, fallbackFrom, translatedText})
  }
}
