export const LABEL_SEARCH_MODES = ['exact', 'prefix', 'glob', 'text'] as const

export type TLabelSearchMode = typeof LABEL_SEARCH_MODES[number]

export interface ILabelSearchOptions {
  cwd?: string
  ignoreCase?: boolean
  languages?: string[]
  limit?: number
  mode?: TLabelSearchMode
  query: string
}

export interface ILabelSearchTranslation {
  language: string
  value: null | string
}

export interface ILabelSearchResult {
  key: string
  translations: readonly ILabelSearchTranslation[]
}

export interface ILabelSearchReport {
  ignoreCase: boolean
  languages: readonly string[]
  limit: null | number
  mode: TLabelSearchMode
  query: string
  results: readonly ILabelSearchResult[]
  total: number
  truncated: boolean
}
