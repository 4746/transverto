import type {IConfig} from './config.js'

export interface IResolvedLabelSuggestionConfig {
  count: number
  labelValidation: string
  showInvalid: boolean
}

const positiveInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer.`)
  }

  return value as number
}

export const resolveLabelSuggestionConfig = (
  config: Pick<IConfig, 'labelSuggestionCount' | 'labelSuggestionShowInvalid' | 'labelValidation'>,
  countOverride?: number,
): IResolvedLabelSuggestionConfig => {
  const count = positiveInteger(
    countOverride ?? config.labelSuggestionCount,
    countOverride === undefined ? 'labelSuggestionCount' : '--count',
  )

  if (typeof config.labelSuggestionShowInvalid !== 'boolean') {
    throw new TypeError('labelSuggestionShowInvalid must be a boolean.')
  }

  if (typeof config.labelValidation !== 'string') {
    throw new TypeError('labelValidation must be a valid regular expression.')
  }

  try {
    const pattern = new RegExp(config.labelValidation)
    pattern.test('')
  } catch {
    throw new Error('labelValidation must be a valid regular expression.')
  }

  return {
    count,
    labelValidation: config.labelValidation,
    showInvalid: config.labelSuggestionShowInvalid,
  }
}
