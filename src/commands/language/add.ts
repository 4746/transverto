import {Args, Flags} from '@oclif/core'

import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LanguageProjectService} from '../../shared/language.service.js'

export default class LanguageAdd extends LabelBaseCommand<typeof LanguageAdd> {
  static args = {
    code: Args.string({description: 'language code to add', required: true}),
  }

  static description = 'Add a language to the project'

  static examples = [
    '<%= config.bin %> <%= command.id %> uk',
    '<%= config.bin %> <%= command.id %> de --copy-from en',
  ]

  static flags = {
    'copy-from': Flags.string({description: 'initialize the dictionary from a configured language', helpValue: 'lang'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LanguageAdd)

    try {
      const result = await (await LanguageProjectService.load()).add(args.code, flags['copy-from'])
      this.log(`Added language "${result.code}".`)
      this.log(`Dictionary: ${result.file}`)
      this.log(`Types: ${result.typesFile}`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
