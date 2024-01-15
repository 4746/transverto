/**
 * The types of translation engines available.
 */
export type TEngineTranslation = 'bing' | 'terra';

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
