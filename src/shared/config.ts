import {DEFAULT_USER_AGENT} from "./constants.js";
import {IBingConfig} from "./entities/bing.config.js";
import {IGoogleConfig} from "./entities/google.config.js";
import {ITerraConfig} from "./entities/terra.config.js";
import {TEngineTranslation} from "./entities/translation.engine.js";

export const LANG_CODE_DEFAULT = 'en';
export const LABEL_VALIDATION_DEFAULT = '^[a-z0-9\\.\\-\\_]{3,100}$';

export interface IConfig {
  /**
   * The base path where is your translation json files
   */
  basePath: string;
  /**
   * The base path for language assets.
   */
  basePathEnum: string;
  /**
   * Configuration options for Bing setting.
   */
  bing?: IBingConfig;
  engine: TEngineTranslation;
  engineUseCache?: false;
  /**
   * Configuration options for Google setting.
   */
  google?: IGoogleConfig;
  /**
   * Regular expression pattern for validating labels.
   *
   * The label should only contain lowercase letters, numbers, periods, hyphens, and underscores.
   * It should also be between 3 and 100 characters long.
   */
  labelValidation: string;
  langCodeDefault: string;
  /**
   * List languages for cli.
   */
  languages: string[];
  nameEnum?: string;
  /**
   * Configuration options for TerraPrint.
   */
  terra?: ITerraConfig;
  userAgent: string;
}

export const CONFIG_DEFAULT: IConfig = {
  /**
   * The base path where is your translation json files
   */
  basePath: "dist/i18n",
  /**
   * The base path for language assets.
   */
  basePathEnum: 'dist/i18n/language.ts',
  /**
   * Configuration options for Bing setting.
   */
  bing: {
    agent: null,
    correct: false,
    raw: false,
    userAgent: DEFAULT_USER_AGENT
  },
  engine: "bing",
  engineUseCache: false,
  /**
   * Regular expression pattern for validating labels.
   *
   * The label should only contain lowercase letters, numbers, periods, hyphens, and underscores.
   * It should also be between 3 and 100 characters long.
   */
  labelValidation: LABEL_VALIDATION_DEFAULT,
  langCodeDefault: LANG_CODE_DEFAULT,
  /**
   * List languages for cli.
   */
  languages: [LANG_CODE_DEFAULT],
  nameEnum: "LanguageLabel",
  /**
   * Configuration options for TerraPrint.
   */
  terra: {
    apiKey: null,
    fromLangCode: 'auto',
    toLangCode: 'uk',
    userAgent: DEFAULT_USER_AGENT
  },
  userAgent: DEFAULT_USER_AGENT
}
