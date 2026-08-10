import {checkbox, confirm, select} from '@inquirer/prompts'
import {Command} from '@oclif/core'

import type {
  IPresetInspection,
  IPresetInstallReport,
  TPresetCommandId,
  TPresetProviderId,
} from '../shared/entities/preset.js'
import type {
  IInspectPresetProjectInput,
  IInstallPresetOptions,
} from '../shared/preset-project.service.js'

import {getPresetCommands, getPresetProvider, PRESET_PROVIDERS} from '../shared/preset-catalog.js'
import {inspectPresetProject, installPreset} from '../shared/preset-project.service.js'

interface IChoice<T> {
  checked?: boolean
  name: string
  value: T
}

interface ISelectProviderOptions {
  choices: IChoice<TPresetProviderId>[]
  message: string
}

interface ISelectCommandsOptions {
  choices: IChoice<TPresetCommandId>[]
  message: string
  required: boolean
}

interface IConfirmOverwriteOptions {
  default: boolean
  message: string
}

export interface IPresetPromptDependencies {
  confirmOverwrite(options: IConfirmOverwriteOptions): Promise<boolean>
  inspect(input: IInspectPresetProjectInput): Promise<IPresetInspection>
  install(inspection: IPresetInspection, options: IInstallPresetOptions): Promise<IPresetInstallReport>
  selectCommands(options: ISelectCommandsOptions): Promise<TPresetCommandId[]>
  selectProvider(options: ISelectProviderOptions): Promise<TPresetProviderId>
}

export interface IPresetPromptResult {
  provider: TPresetProviderId
  report: IPresetInstallReport
}

const DEFAULT_DEPENDENCIES: IPresetPromptDependencies = {
  confirmOverwrite: options => confirm(options),
  inspect: inspectPresetProject,
  install: installPreset,
  selectCommands: options => checkbox<TPresetCommandId>(options),
  selectProvider: options => select<TPresetProviderId>(options),
}

export async function runPresetPrompts(
  projectRoot: string,
  overrides: Partial<IPresetPromptDependencies> = {},
): Promise<IPresetPromptResult> {
  const dependencies = {...DEFAULT_DEPENDENCIES, ...overrides}
  const provider = await dependencies.selectProvider({
    choices: PRESET_PROVIDERS.map(({id: value, name}) => ({name, value})),
    message: 'Preset:',
  })
  const commands = await dependencies.selectCommands({
    choices: getPresetCommands(provider).map(({id: value, name}) => ({checked: true, name, value})),
    message: 'Commands:',
    required: true,
  })
  const inspection = await dependencies.inspect({commands, projectRoot, provider})
  const overwrite = inspection.conflicts.length === 0 || await dependencies.confirmOverwrite({
    default: true,
    message: `Overwrite ${inspection.conflicts.length} existing ${getPresetProvider(provider).name} run configurations?`,
  })
  const report = await dependencies.install(inspection, {overwrite})
  return {provider, report}
}

export const renderPresetResult = (
  result: IPresetPromptResult,
  log: (line: string) => void,
): void => {
  log(`${getPresetProvider(result.provider).name} preset installed.`)
  log(`Created: ${result.report.created.length}`)
  log(`Overwritten: ${result.report.overwritten.length}`)
  log(`Preserved: ${result.report.preserved.length}`)
  log(`npm script: ${result.report.script}`)
}

export default class Preset extends Command {
  static description = 'Install IDE run configuration presets'
  static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    let result: IPresetPromptResult
    try {
      result = await runPresetPrompts(process.cwd())
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') throw error
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }

    renderPresetResult(result, line => this.log(line))
  }
}
