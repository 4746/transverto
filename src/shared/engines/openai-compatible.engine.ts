import {
  ILabelSuggestionRequest,
  LabelSuggestionEngine,
} from '../entities/label-suggestion.js'
import {
  TranslationError,
  TTranslationErrorCategory,
} from '../entities/translation-error.js'
import {
  IMultiLanguageEngineResponse,
  IMultiLanguageTranslationRequestPlan,
  IResolvedEngineProfile,
  ITranslationRequestPlan,
  TranslationEngine,
} from '../entities/translation.engine.js'
import {parseLabelSuggestionCompletion} from '../label-suggestion-response.js'
import {parseMultiLanguageCompletion} from '../multi-language-response.js'

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

interface IChatCompletionRequest {
  messages: Array<{content: string; role: 'system' | 'user'}>
  model: string
  reasoning?: {enabled: boolean}
  reasoning_effort?: 'none'
  stream: false
  temperature: number
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const DEFAULT_LABEL_SUGGESTION_PROMPT = [
  'You create concise English localization keys for web user interfaces.',
  'Prefer conventional UI terminology and useful variations of the input meaning.',
].join('\n')

const reasoningRequest = (
  profile: IResolvedEngineProfile,
): Pick<IChatCompletionRequest, 'reasoning' | 'reasoning_effort'> => {
  if (profile.reasoning === undefined) return {}
  if (profile.provider === 'openrouter') {
    return {reasoning: {enabled: profile.reasoning}}
  }

  return profile.reasoning ? {} : {'reasoning_effort': 'none'}
}

const buildSystemPrompt = ({from, to, key, sourceText}: ITranslationRequestPlan): string => [
  'You are a professional localization engine for web user interfaces.',
  'All source texts are elements of websites or web applications, such as buttons, labels, form fields, menus, headings, tooltips, notifications, and validation messages.',
  ``,
  `Source language: ${from}`,
  `Target language: ${to}`,
  `Localization key: ${key}`,
  `Source text: ${sourceText}`,
  ``,
  `Translate only the source text from the source language to the target language.`,
  `Use the localization key only as context to determine the meaning and role of the source text in the web interface. Do not translate or return the localization key.`,
  `Use concise, natural, and conventional terminology used in web interfaces in the target language.`,
  `For buttons, links, menu items, and other actions, use the grammatical form conventionally displayed for that type of interface element in the target language. Do not mechanically preserve the grammatical form or mood of the source text.`,
  `Preserve placeholders, HTML tags, template expressions, punctuation, capitalization, whitespace, paragraph structure, and formatting.`,
  `Return only the translated source text without explanations, labels, metadata, quotes, JSON, or Markdown.`,
].join('\n')

const buildBatchSystemPrompt = ({from, key, sourceText, targets}: IMultiLanguageTranslationRequestPlan): string => [
  'You are a professional localization engine for web user interfaces.',
  'All source texts are elements of websites or web applications, such as buttons, labels, form fields, menus, headings, tooltips, notifications, and validation messages.',
  '',
  `Source language: ${from}`,
  `Target languages: ${targets.join(', ')}`,
  `Localization key: ${key}`,
  `Source text: ${sourceText}`,
  '',
  'Translate the source text into every requested target language.',
  'Use the localization key only as context. Do not translate or return the key.',
  'Use concise, natural, and conventional terminology used in web interfaces.',
  'Preserve placeholders, HTML tags, template expressions, punctuation, capitalization, whitespace, paragraph structure, and formatting.',
  'Return exactly one JSON object with one property for every requested target language.',
  'Use each requested language code as the property name and its translated text as the string value.',
  'Do not return Markdown fences, explanations, metadata, nested objects, arrays, or unrequested language codes.',
].join('\n')

const buildLabelSuggestionPrompt = ({
  count,
  labelValidation,
  text,
}: ILabelSuggestionRequest): string => [
  `Input text: ${text}`,
  '',
  'Understand the input in its original language and translate its meaning internally when needed.',
  `Return ${count} unique English localization key suggestions.`,
  'Every suggestion must use English words.',
  `Every suggestion must match this regular expression: ${labelValidation}`,
  'Return exactly one JSON array containing only string values.',
  'Do not return Markdown fences, explanations, labels, metadata, or any text outside the JSON array.',
].join('\n')

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

export class OpenAICompatibleEngine implements LabelSuggestionEngine, TranslationEngine {
  constructor(
    private readonly profile: IResolvedEngineProfile,
    private readonly fetchImplementation: TFetch = fetch,
  ) {}

  async suggestLabels(request: ILabelSuggestionRequest): Promise<string[]> {
    const content = await this.completion(
      this.profile.labelSuggestionPrompt ?? DEFAULT_LABEL_SUGGESTION_PROMPT,
      buildLabelSuggestionPrompt(request),
    )
    return parseLabelSuggestionCompletion(content)
  }

  async translate(request: ITranslationRequestPlan): Promise<string> {
    return this.completion(this.profile.systemPrompt ?? '', buildSystemPrompt(request))
  }

  async translateBatch(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageEngineResponse> {
    const content = await this.completion(
      this.profile.systemPrompt ?? '',
      buildBatchSystemPrompt(request),
    )
    return parseMultiLanguageCompletion(content, request.targets)
  }

  private async completion(systemPrompt: string, userContent: string): Promise<string> {
    if (this.profile.apiKeyEnv && !this.profile.apiKey) {
      throw new TranslationError(
        'authentication',
        `Engine profile "${this.profile.name}" requires environment variable ${this.profile.apiKeyEnv}.`,
        {profile: this.profile},
      )
    }

    const headers: Record<string, string> = {'Content-Type': 'application/json'}
    if (this.profile.apiKey) headers.Authorization = `Bearer ${this.profile.apiKey}`

    const requestBody: IChatCompletionRequest = {
      messages: [
        {content: systemPrompt, role: 'system'},
        {content: userContent, role: 'user'},
      ],
      model: this.profile.model,
      ...reasoningRequest(this.profile),
      stream: false,
      temperature: this.profile.temperature ?? 0,
    }

    let response: Response
    try {
      response = await this.fetchImplementation(`${this.profile.baseUrl}/chat/completions`, {
        body: JSON.stringify(requestBody),
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
