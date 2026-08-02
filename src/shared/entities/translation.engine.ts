/**
 * The types of translation engines available.
 */
export type TEngineTranslation = 'bing' | 'google' | 'terra';

export type TEngineProvider =
  | 'google-ai'
  | 'lmstudio'
  | 'openai-compatible'
  | 'openrouter'

export interface IEngineProfile {
  apiKeyEnv?: string
  baseUrl?: string
  model: string
  provider: TEngineProvider
}

export interface IResolvedEngineProfile extends IEngineProfile {
  apiKey?: string
  baseUrl: string
  name: string
}

export interface ITranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  to: string
}

export interface ITranslationResult extends ITranslationRequestPlan {
  engine: string
  model: string
  translatedText: string
}

export interface ITranslateOutput {
  dryRun: boolean
  requests: ITranslationRequestPlan[]
  results: ITranslationResult[]
  written: string[]
}

export interface TranslationEngine {
  translate(request: ITranslationRequestPlan): Promise<string>
}

export interface IParamTranslateText {
  /**
   * The language code of source text.
   */
  from?: string;
  /**
   * The text to be translated, can't be blank.
   */
  text: string;
  /**
   * The language in which the text should be translated.
   */
  to: string;
}

export interface BaseEngine {
  translateText(param: IParamTranslateText): Promise<string>;
}
