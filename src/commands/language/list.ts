import {Flags} from '@oclif/core'

import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LanguageProjectService} from '../../shared/language.service.js'

export default class LanguageList extends LabelBaseCommand<typeof LanguageList> {
  static description = 'List configured languages and dictionary status'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    json: Flags.boolean({description: 'output a stable JSON language list'}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(LanguageList)

    try {
      const items = await (await LanguageProjectService.load()).list()
      if (flags.json) {
        this.log(JSON.stringify({languages: items}, null, 2))
        return
      }

      this.log('ROLE    CODE       STATUS   LEAVES  FILE')
      for (const item of items) {
        this.log(
          `${item.role.padEnd(7)} ${item.code.padEnd(10)} ${item.status.padEnd(8)} ${String(item.leafCount ?? '-').padEnd(7)} ${item.file}`,
        )
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
