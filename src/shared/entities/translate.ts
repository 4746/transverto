export interface ITranslation {
  /**
   * lang code
   */
  code: string,
  /**
   * file path.
   */
  file: string,
  translate: NonNullable<object>,
  translateFlatten: Record<string, string | string[]>
}

export type TTranslation = Record<string, ITranslation>;
