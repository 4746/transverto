import {confirm} from '@inquirer/prompts'
import {Args, Flags} from '@oclif/core'

import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LanguageProjectService} from '../../shared/language.service.js'

export default class LanguageRemove extends LabelBaseCommand<typeof LanguageRemove> {
  static args = {
    code: Args.string({description: 'language code to remove', required: true}),
  }

  static description = 'Remove a language from the project, deleting its JSON file by default'

  static examples = [
    '<%= config.bin %> <%= command.id %> uk',
    '<%= config.bin %> <%= command.id %> uk --force',
    '<%= config.bin %> <%= command.id %> uk --keep-file',
    '<%= config.bin %> <%= command.id %> en --source uk --force',
    '<%= config.bin %> <%= command.id %> uk --delete-file --force',
  ]

  static flags = {
    'delete-file': Flags.boolean({
      description: 'delete the language JSON file (default; retained for compatibility)',
      exclusive: ['keep-file'],
    }),
    force: Flags.boolean({char: 'f', description: 'skip deletion confirmation'}),
    'keep-file': Flags.boolean({
      description: 'preserve the language JSON file',
      exclusive: ['delete-file'],
    }),
    source: Flags.string({description: 'replacement source language when removing the current source', helpValue: 'lang'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LanguageRemove)
    const deleteFile = !flags['keep-file']

    try {
      if (deleteFile && !flags.force) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          this.error('Non-interactive file deletion requires --force.', {exit: 2})
        }

        const accepted = await confirm({
          default: false,
          message: `Delete the JSON file for language "${args.code}"?`,
        })
        if (!accepted) {
          this.log('No changes made.')
          return
        }
      }

      const result = await (await LanguageProjectService.load()).remove(args.code, {
        deleteFile,
        source: flags.source,
      })
      this.log(`Removed language "${result.code}" from configuration.`)
      this.log(deleteFile ? `Deleted: ${result.file}` : `Preserved: ${result.file}`)
      this.log(`Types: ${result.typesFile}`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
