import type {Agent as HttpsAgent} from "node:https";

import {TBingLangCode, TBingLangCodeExtend} from "../lang.bing.js";

export interface IBingProxyAgents {
  http?:  | false;
  http2?: false | unknown;
  https?: HttpsAgent | false;
}
export interface IBingConfig {
  agent?: string;
  /**
   * Whether to correct the input text.
   */
  correct?: boolean;
  proxyAgents?: IBingProxyAgents;
  /**
   * Whether the translation result contains raw response from Bing API.
   */
  raw?: boolean;
  userAgent?: string;
}
export interface IBingFetchConfig {
  IG: string;
  IID: string;
  count: number;
  key: number;
  subdomain?: string;
  token: string;
  tokenExpiryInterval: number;
  tokenTs: number;
}
export interface IBingRequestBody {
  fromLang: TBingLangCodeExtend;
  key: number;
  text: string;
  to?: TBingLangCode | TBingLangCodeExtend;
  token: string;
  tryFetchingGenderDebiasedTranslations?: true
}
export interface IBingTranslationResult {
  /**
   * The corrected text. This is returned only when the `correct` option is set as `true`
   */
  correctedText?: string;
  /**
   * The detected language
   */
  language: {
    /**
     * The detected language code of original text
     */
    from: string;
    /**
     * The score of language detection
     */
    score: number;
    /**
     * The language code of translated text
     */
    to: string;
  };
  /**
   * The original response from Bing translator
   */
  raw?: unknown
  /**
   * The original text
   */
  text: string;
  /**
   * The translated text
   */
  translation: string;
  /**
   * The user-specified language code
   */
  userLang: string;
}
