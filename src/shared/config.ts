import {IEngineProfile} from "./entities/translation.engine.js";

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
  engine: null | string;
  engines: Record<string, IEngineProfile>;
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
  engine: null,
  engines: {},
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
}
