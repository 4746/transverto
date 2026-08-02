import {IConfig} from './config.js'

type TDictionary = Record<string, unknown>

const isObject = (value: unknown): value is TDictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function collectTranslationKeys(dictionary: TDictionary): string[] {
  const keys: string[] = []

  const visit = (object: TDictionary, prefix = ''): void => {
    for (const [key, value] of Object.entries(object)) {
      const keyPath = prefix ? `${prefix}.${key}` : key
      if (isObject(value)) visit(value, keyPath)
      else if (typeof value === 'string') keys.push(keyPath)
      else throw new Error(`Translation leaf "${keyPath}" must be a string.`)
    }
  }

  visit(dictionary)
  return [...new Set(keys)].sort()
}

const quoteTypeValue = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

export function generateTypesContent(config: IConfig, sourceDictionary: TDictionary): string {
  const enumName = config.nameEnum ?? 'LanguageLabel'
  const enumLines = config.languages.map(language => {
    const member = language.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')
    return `  ${member} = ${quoteTypeValue(language)},`
  })
  const keys = collectTranslationKeys(sourceDictionary)
  const keyType = keys.length === 0
    ? 'never'
    : keys.map((key, index) => `${index === 0 ? '' : '  | '}${quoteTypeValue(key)}`).join('\n')

  return [
    '/* eslint-disable */',
    '/**',
    ' * DO NOT EDIT!',
    ' * THIS IS AUTOMATICALLY GENERATED FILE',
    ' */',
    '',
    `export enum E${enumName} {`,
    ...enumLines,
    '}',
    '',
    `export type T${enumName} = ${keyType};`,
    '',
    `export type T${enumName}OrString = T${enumName} | string;`,
    `export type T${enumName}OrNever = T${enumName} | never;`,
    '',
  ].join('\n')
}
