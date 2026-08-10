export type TPresetProviderId = 'jetbrains'
export type TPresetCommandId = 'add' | 'delete' | 'doctor' | 'get' | 'rename' | 'status' | 'suggest'

export interface IPresetCommandDefinition {
  assetFile: string
  id: TPresetCommandId
  name: string
  targetFile: string
}

export interface IPresetProviderDefinition {
  commands: readonly IPresetCommandDefinition[]
  id: TPresetProviderId
  name: string
}
