import type {
  ILabelSuggestionRequest,
  ILabelSuggestionResult,
  LabelSuggestionEngine,
} from './entities/label-suggestion.js'

export class LabelSuggestionService {
  constructor(private readonly engine: LabelSuggestionEngine) {}

  async suggest(request: ILabelSuggestionRequest): Promise<ILabelSuggestionResult> {
    const candidates = await this.engine.suggestLabels(request)
    const pattern = new RegExp(request.labelValidation)
    const seen = new Set<string>()
    const invalidSuggestions: string[] = []
    const suggestions: string[] = []

    for (const candidate of candidates) {
      const value = candidate.trim()
      if (seen.has(value)) continue

      seen.add(value)
      if (pattern.test(value)) suggestions.push(value)
      else invalidSuggestions.push(value)
      pattern.lastIndex = 0
    }

    return {invalidSuggestions, suggestions}
  }
}
