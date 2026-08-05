export interface ILabelSuggestionRequest {
  count: number
  labelValidation: string
  text: string
}

export interface ILabelSuggestionResult {
  invalidSuggestions: string[]
  suggestions: string[]
}

export interface ILabelSuggestionOutput {
  invalidSuggestions?: string[]
  suggestions: string[]
}

export interface LabelSuggestionEngine {
  suggestLabels(request: ILabelSuggestionRequest): Promise<string[]>
}
