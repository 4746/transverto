import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {
  IPresetProviderDefinition,
} from './entities/preset.js'
export type {TPresetCommandId, TPresetProviderId} from './entities/preset.js'

const PRESETS_ROOT = fileURLToPath(new URL('../../presets/', import.meta.url))

export const PRESET_PROVIDERS = Object.freeze([
  {
    commands: Object.freeze([
      {assetFile: 'tl_add.run.xml', id: 'add', name: 'add', targetFile: 'tl_add.run.xml'},
      {assetFile: 'tl_delete.run.xml', id: 'delete', name: 'delete', targetFile: 'tl_delete.run.xml'},
      {assetFile: 'tl_doctor.run.xml', id: 'doctor', name: 'doctor', targetFile: 'tl_doctor.run.xml'},
      {assetFile: 'tl_get.run.xml', id: 'get', name: 'get', targetFile: 'tl_get.run.xml'},
      {assetFile: 'tl_rename.run.xml', id: 'rename', name: 'rename', targetFile: 'tl_rename.run.xml'},
      {assetFile: 'tl_status.run.xml', id: 'status', name: 'status', targetFile: 'tl_status.run.xml'},
      {assetFile: 'tl_suggest.run.xml', id: 'suggest', name: 'suggest', targetFile: 'tl_suggest.run.xml'},
    ]),
    id: 'jetbrains',
    name: 'JetBrains',
  },
] satisfies readonly IPresetProviderDefinition[])

export const getPresetProvider = (id: string): IPresetProviderDefinition => {
  const provider = PRESET_PROVIDERS.find(item => item.id === id)
  if (!provider) throw new Error(`Unknown preset provider: ${id}.`)
  return provider
}

export const getPresetCommands = (providerId: string) =>
  getPresetProvider(providerId).commands

export const resolvePresetAssetPath = (providerId: string, commandId: string): string => {
  const provider = getPresetProvider(providerId)
  const command = provider.commands.find(item => item.id === commandId)
  if (!command) throw new Error(`Unknown preset command: ${commandId}.`)
  return path.join(PRESETS_ROOT, provider.id, command.assetFile)
}
