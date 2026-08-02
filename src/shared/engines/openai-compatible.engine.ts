import {
  IResolvedEngineProfile,
  ITranslationRequestPlan,
  TranslationEngine,
} from '../entities/translation.engine.js'

type TFetch = typeof fetch

interface IChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  error?: {
    message?: unknown
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const buildSystemPrompt = ({from, to}: ITranslationRequestPlan): string => [
  'You are a professional translation engine.',
  `Translate the user text from ${from} to ${to}.`,
  'Return only the translated text without explanations, labels, quotes, or Markdown fences.',
  'Preserve placeholders, punctuation, paragraph structure, and formatting.',
].join(' ')

const providerMessage = (body: unknown): string | undefined => {
  if (!isObject(body) || !isObject(body.error)) return
  return typeof body.error.message === 'string' ? body.error.message : undefined
}

export class OpenAICompatibleEngine implements TranslationEngine {
  constructor(
    private readonly profile: IResolvedEngineProfile,
    private readonly fetchImplementation: TFetch = fetch,
  ) {}

  async translate(request: ITranslationRequestPlan): Promise<string> {
    const headers: Record<string, string> = {'Content-Type': 'application/json'}
    if (this.profile.apiKey) headers.Authorization = `Bearer ${this.profile.apiKey}`

    let response: Response
    try {
      response = await this.fetchImplementation(`${this.profile.baseUrl}/chat/completions`, {
        body: JSON.stringify({
          messages: [
            {content: buildSystemPrompt(request), role: 'system'},
            {content: request.sourceText, role: 'user'},
          ],
          model: this.profile.model,
          stream: false,
          temperature: 0,
        }),
        headers,
        method: 'POST',
      })
    } catch (error) {
      throw new Error(
        `Engine profile "${this.profile.name}" (${this.profile.model}) request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    let body: IChatCompletionResponse
    try {
      body = await response.json() as IChatCompletionResponse
    } catch {
      throw new Error(
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned invalid JSON with HTTP ${response.status}.`,
      )
    }

    if (!response.ok) {
      const message = providerMessage(body)
      throw new Error(
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned HTTP ${response.status}${message ? `: ${message}` : '.'}`,
      )
    }

    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error(
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned an empty or invalid completion.`,
      )
    }

    return content
  }
}
