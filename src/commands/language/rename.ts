import {Args} from '@oclif/core'

import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LanguageProjectService} from '../../shared/language.service.js'

export default class LanguageRename extends LabelBaseCommand<typeof LanguageRename> {
  static args = {
    from: Args.string({description: 'configured language code', required: true}),
    to: Args.string({description: 'new language code', required: true}),
  }

  static description = 'Rename a configured language and its JSON file'

  static examples = [
    '<%= config.bin %> <%= command.id %> en en-US',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(LanguageRename)

    try {
      const result = await (await LanguageProjectService.load()).rename(args.from, args.to)
      this.log(`Renamed language "${args.from}" to "${result.code}".`)
      this.log(`Dictionary: ${result.file}`)
      this.log(`Types: ${result.typesFile}`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
