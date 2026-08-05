import {confirm} from '@inquirer/prompts'

export interface ILabelAddOverwritePromptOptions {
  interactive: boolean
  key: string
  output?: NodeJS.WritableStream
}

export type TLabelAddOverwritePrompt = typeof confirm

export const confirmLabelAddOverwrite = async (
  options: ILabelAddOverwritePromptOptions,
  ask: TLabelAddOverwritePrompt = confirm,
): Promise<boolean> => {
  if (!options.interactive) {
    throw new Error(
      `Translation key "${options.key}" already exists; overwriting it requires interactive confirmation.`,
    )
  }

  return ask(
    {
      default: false,
      message: `Key "${options.key}" already exists. Overwrite it?`,
    },
    {output: options.output ?? process.stdout},
  )
}
