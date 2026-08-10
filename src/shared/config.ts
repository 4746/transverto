import type {ITranslationBatchConfig} from './entities/translation-batch.js'

import {CTV_CONFIG_SCHEMA_PATH} from './constants.js'
import {ITranslationCacheConfig} from './entities/translation-cache.js'
import {IEngineProfile} from "./entities/translation.engine.js";
import {TRANSLATION_BATCH_DEFAULTS} from './translation-batch.config.js'

export const LANG_CODE_DEFAULT = 'en';
export const LABEL_VALIDATION_DEFAULT = '^[a-z0-9\\.\\_]{2,100}$';
export const LABEL_SUGGESTION_COUNT_DEFAULT = 5;
export const LABEL_SUGGESTION_SHOW_INVALID_DEFAULT = false;

export interface IConfig {
  $schema?: string;
  /**
   * The base path where is your translation json files
   */
  basePath: string;
  /**
   * The base path for language assets.
   */
  basePathEnum: string;
  batch?: Partial<ITranslationBatchConfig>;
  cache: ITranslationCacheConfig;
  engine: null | string;
  engines: Record<string, IEngineProfile>;
  fallback?: null | string;
  /**
   * Regular expression pattern for validating labels.
   *
   * Accepted labels must match this configured pattern.
   */
  labelValidation: string;
  labelSuggestionCount: number;
  labelSuggestionShowInvalid: boolean;
  langCodeDefault: string;
  /**
   * List languages for cli.
   */
  languages: string[];
  nameEnum?: string;
}

export const CONFIG_DEFAULT: IConfig & {batch: ITranslationBatchConfig} = {
  $schema: CTV_CONFIG_SCHEMA_PATH,
  /**
   * The base path where is your translation json files
   */
  basePath: "dist/i18n",
  /**
   * The base path for language assets.
   */
  basePathEnum: 'dist/i18n/language.ts',
  batch: {...TRANSLATION_BATCH_DEFAULTS},
  cache: {
    maxEntries: 1000,
    ttlMs: 2_592_000_000,
  },
  engine: null,
  engines: {},
  fallback: null,
  /**
   * Regular expression pattern for validating labels.
   *
   * Accepted labels must match this configured pattern.
   */
  labelValidation: LABEL_VALIDATION_DEFAULT,
  labelSuggestionCount: LABEL_SUGGESTION_COUNT_DEFAULT,
  labelSuggestionShowInvalid: LABEL_SUGGESTION_SHOW_INVALID_DEFAULT,
  langCodeDefault: LANG_CODE_DEFAULT,
  /**
   * List languages for cli.
   */
  languages: [LANG_CODE_DEFAULT],
  nameEnum: "LanguageLabel",
}
