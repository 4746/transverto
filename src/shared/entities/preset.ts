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

export interface IPresetInspectionTarget {
  asset: Buffer
  command: TPresetCommandId
  original: Buffer | null
  relativeTarget: string
  target: string
}

export interface IPresetInspection {
  conflicts: readonly string[]
  packageFile: string
  packageOriginal: Buffer
  packageUpdated: Buffer | null
  projectRoot: string
  provider: TPresetProviderId
  script: 'added' | 'preserved'
  targets: readonly IPresetInspectionTarget[]
}

export interface IPresetInstallReport {
  created: string[]
  overwritten: string[]
  preserved: string[]
  script: 'added' | 'preserved'
}
