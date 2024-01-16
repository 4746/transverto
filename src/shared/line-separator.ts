/**
 * OS line ending
 */
export enum ELineSeparator {
  /** Classic Mac OS */
  CR = "\r",
  /** Windows */
  CRLF = "\r\n",
  /** Unix */
  LF = "\n",
}

export type TLineSeparatorLower = Lowercase<keyof typeof ELineSeparator>;
/**
 * Array of lowercase string values of the ELineSeparator enum.
 */
export const LINE_SEPARATOR_LOWER = Object.keys(ELineSeparator).map((v) => v.toLowerCase()) as TLineSeparatorLower[];
