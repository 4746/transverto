import {input} from '@inquirer/prompts'

export interface IResolveLabelRenameTargetInput {
  interactive: boolean
  newPath?: string
  output: NodeJS.WritableStream
}

export type TLabelRenameTargetPrompt = typeof input

export async function resolveLabelRenameTarget(
  options: IResolveLabelRenameTargetInput,
  ask: TLabelRenameTargetPrompt = input,
): Promise<string> {
  if (options.newPath) return options.newPath
  if (!options.interactive) {
    throw new Error('Missing target key. Pass NEW when running non-interactively.')
  }

  return ask({
    message: 'New translation key:',
    validate: value => value.trim().length > 0 || 'New translation key is required.',
  }, {output: options.output})
}
