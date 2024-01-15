import {TTerraLangCode, TTerraLangCodeExtend} from "../lang.terra.js";

export interface ITerraConfig {
  /**
   * API key
   */
  apiKey?: string;
  /**
   * Original language code
   */
  fromLangCode?: TTerraLangCodeExtend;
  /**
   * Translation language code
   */
  toLangCode?: TTerraLangCode;
  userAgent?: string;
}

export interface ITerraTranslationResult {
  detectedLanguage?: {
    confidence: number,
    language: TTerraLangCode
  },
  /**
   * Description: Represents an error message.
   * status code [400, 403, 429, 500]
   */
  error?: string;
  /**
   * Translated text
   */
  translatedText?: string;
}
