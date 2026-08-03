import {
  TranslationError,
  TTranslationErrorCategory,
} from '../entities/translation-error.js'
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

const statusCategory = (status: number): TTranslationErrorCategory => {
  if (status === 401 || status === 403) return 'authentication'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'provider_unavailable'
  if ([400, 404, 409, 422].includes(status)) return 'validation'
  return 'provider_response'
}

export class OpenAICompatibleEngine implements TranslationEngine {
  constructor(
    private readonly profile: IResolvedEngineProfile,
    private readonly fetchImplementation: TFetch = fetch,
  ) {}

  async translate(request: ITranslationRequestPlan): Promise<string> {
    if (this.profile.apiKeyEnv && !this.profile.apiKey) {
      throw new TranslationError(
        'authentication',
        `Engine profile "${this.profile.name}" requires environment variable ${this.profile.apiKeyEnv}.`,
        {profile: this.profile},
      )
    }

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
        signal: AbortSignal.timeout(this.profile.timeoutMs),
      })
    } catch (error) {
      const category = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
        ? 'timeout'
        : 'network'
      throw new TranslationError(
        category,
        `Engine profile "${this.profile.name}" (${this.profile.model}) request failed: ${error instanceof Error ? error.message : String(error)}`,
        {cause: error, profile: this.profile},
      )
    }

    let body: IChatCompletionResponse
    try {
      body = await response.json() as IChatCompletionResponse
    } catch (error) {
      throw new TranslationError(
        statusCategory(response.status),
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned invalid JSON with HTTP ${response.status}.`,
        {cause: error, profile: this.profile, status: response.status},
      )
    }

    if (!response.ok) {
      const message = providerMessage(body)
      throw new TranslationError(
        statusCategory(response.status),
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned HTTP ${response.status}${message ? `: ${message}` : '.'}`,
        {profile: this.profile, status: response.status},
      )
    }

    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new TranslationError(
        'provider_response',
        `Engine profile "${this.profile.name}" (${this.profile.model}) returned an empty or invalid completion.`,
        {profile: this.profile, status: response.status},
      )
    }

    return content
  }
}
