import {IConfig} from './config.js'
import {
  IEngineProfile,
  IResolvedEngineProfile,
  TEngineProvider,
} from './entities/translation.engine.js'

export const ENGINE_PROVIDERS: TEngineProvider[] = [
  'lmstudio',
  'google-ai',
  'openrouter',
  'openai-compatible',
]

export const ENGINE_TIMEOUT_DEFAULT_MS = 30_000

export const ENGINE_PROVIDER_DEFAULTS: Record<
  TEngineProvider,
  {baseUrl: null | string; requiresApiKey: boolean}
> = {
  lmstudio: {baseUrl: 'http://localhost:1234/v1', requiresApiKey: false},
  'google-ai': {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresApiKey: true,
  },
  openrouter: {baseUrl: 'https://openrouter.ai/api/v1', requiresApiKey: true},
  'openai-compatible': {baseUrl: null, requiresApiKey: false},
}

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validateBaseUrl = (value: string, profileName: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Engine profile "${profileName}" has an invalid baseUrl.`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Engine profile "${profileName}" baseUrl must use HTTP or HTTPS.`)
  }

  return value.replace(/\/+$/, '')
}

const validateTimeout = (value: unknown, profileName: string): number | undefined => {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Engine profile "${profileName}" timeoutMs must be a positive integer.`)
  }

  return value as number
}

const validateTemperature = (value: unknown, profileName: string): number | undefined => {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(
      `Engine profile "${profileName}" temperature must be a finite number from 0 through 2.`,
    )
  }

  return value
}

const validateProfile = (name: string, rawProfile: unknown): IEngineProfile => {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error(`Engine profile name "${name}" is invalid.`)
  }

  if (!isObject(rawProfile)) {
    throw new Error(`Engine profile "${name}" must be an object.`)
  }

  const {
    apiKeyEnv,
    baseUrl,
    model,
    provider,
    reasoning,
    systemPrompt,
    temperature,
    timeoutMs,
  } = rawProfile
  const validatedTemperature = validateTemperature(temperature, name)
  const validatedTimeout = validateTimeout(timeoutMs, name)
  if (!ENGINE_PROVIDERS.includes(provider as TEngineProvider)) {
    throw new Error(`Engine profile "${name}" has an unsupported provider.`)
  }

  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error(`Engine profile "${name}" requires a non-empty model.`)
  }

  if (apiKeyEnv !== undefined && (
    typeof apiKeyEnv !== 'string' || !ENVIRONMENT_NAME_PATTERN.test(apiKeyEnv)
  )) {
    throw new Error(`Engine profile "${name}" has an invalid apiKeyEnv.`)
  }

  const defaults = ENGINE_PROVIDER_DEFAULTS[provider as TEngineProvider]
  if (defaults.requiresApiKey && apiKeyEnv === undefined) {
    throw new Error(`Engine profile "${name}" requires apiKeyEnv.`)
  }

  if (baseUrl !== undefined && typeof baseUrl !== 'string') {
    throw new Error(`Engine profile "${name}" baseUrl must be a string.`)
  }

  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    throw new Error(`Engine profile "${name}" systemPrompt must be a string.`)
  }

  if (reasoning !== undefined && typeof reasoning !== 'boolean') {
    throw new Error(`Engine profile "${name}" reasoning must be a boolean.`)
  }

  const resolvedBaseUrl = typeof baseUrl === 'string' ? baseUrl : defaults.baseUrl
  if (!resolvedBaseUrl) {
    throw new Error(`Engine profile "${name}" requires baseUrl.`)
  }

  return {
    ...(typeof apiKeyEnv === 'string' ? {apiKeyEnv} : {}),
    ...(typeof baseUrl === 'string' ? {baseUrl: validateBaseUrl(baseUrl, name)} : {}),
    model: model.trim(),
    provider: provider as TEngineProvider,
    ...(typeof reasoning === 'boolean' ? {reasoning} : {}),
    ...(typeof systemPrompt === 'string' ? {systemPrompt} : {}),
    ...(validatedTemperature === undefined ? {} : {temperature: validatedTemperature}),
    ...(validatedTimeout === undefined ? {} : {timeoutMs: validatedTimeout}),
  }
}

export function validateFallbackConfiguration(
  fallback: unknown,
  engines: Record<string, IEngineProfile>,
  primary?: null | string,
): null | string {
  if (fallback === undefined || fallback === null) return null
  if (typeof fallback !== 'string' || fallback.length === 0) {
    throw new Error('Configuration field "fallback" must be a profile name or null.')
  }

  if (!(fallback in engines)) {
    throw new Error(`Fallback engine profile "${fallback}" is not configured.`)
  }

  if (fallback === primary) {
    throw new Error('Fallback engine profile must differ from the primary profile.')
  }

  return fallback
}

export interface IResolveEngineProfileOptions {
  requireCredentials?: boolean
}

export function validateEngineConfiguration(
  engine: unknown,
  engines: unknown,
): Record<string, IEngineProfile> {
  if (engine !== null && (typeof engine !== 'string' || engine.length === 0)) {
    throw new Error('Configuration field "engine" must be a profile name or null.')
  }

  if (!isObject(engines)) {
    throw new Error('Configuration field "engines" must be an object.')
  }

  const validated: Record<string, IEngineProfile> = {}
  for (const [name, rawProfile] of Object.entries(engines)) {
    validated[name] = validateProfile(name, rawProfile)
  }

  if (typeof engine === 'string' && !(engine in validated)) {
    throw new Error(`Active engine profile "${engine}" is not configured.`)
  }

  return validated
}

export function resolveEngineProfile(
  config: Pick<IConfig, 'engine' | 'engines'>,
  selectedEngine?: string,
  environment: NodeJS.ProcessEnv = process.env,
  options: IResolveEngineProfileOptions = {},
): IResolvedEngineProfile {
  const engines = validateEngineConfiguration(config.engine, config.engines)
  const name = selectedEngine ?? config.engine
  if (!name) throw new Error('No active translation engine profile is configured.')

  const profile = engines[name]
  if (!profile) throw new Error(`Engine profile "${name}" is not configured.`)

  const defaults = ENGINE_PROVIDER_DEFAULTS[profile.provider]
  const baseUrl = validateBaseUrl(profile.baseUrl ?? defaults.baseUrl, name)
  const apiKey = profile.apiKeyEnv ? environment[profile.apiKeyEnv] : undefined
  if ((options.requireCredentials ?? true) && profile.apiKeyEnv && !apiKey) {
    throw new Error(
      `Engine profile "${name}" requires environment variable ${profile.apiKeyEnv}.`,
    )
  }

  return {
    ...profile,
    ...(apiKey ? {apiKey} : {}),
    baseUrl,
    name,
    timeoutMs: profile.timeoutMs ?? ENGINE_TIMEOUT_DEFAULT_MS,
  }
}
