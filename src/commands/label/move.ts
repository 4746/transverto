import {Args, Flags} from '@oclif/core'

import type {ILabelMutationReport} from '../../shared/entities/label-mutation.js'

import {LabelMutationCommand, labelMutationFlags} from '../../shared/label-mutation.command.js'

export default class LabelMove extends LabelMutationCommand<typeof LabelMove> {
  static args = {
    'old-prefix': Args.string({description: 'existing exact branch prefix', required: true}),
    'new-prefix': Args.string({description: 'new exact branch prefix', required: true}),
  }

  static description = 'Atomically move a translation-key branch across configured languages'
  static enableJsonFlag = true
  static examples = [
    '<%= config.bin %> <%= command.id %> account.profile user.profile --dry-run',
    '<%= config.bin %> <%= command.id %> account user --include "account.*" --write',
    '<%= config.bin %> <%= command.id %> old.section new.section --overwrite --write --json',
  ]

  static flags = {
    ...labelMutationFlags,
    overwrite: Flags.boolean({description: 'replace existing target values or branches'}),
  }

  public async run(): Promise<ILabelMutationReport | void> {
    const {args, flags} = await this.parse(LabelMove)
    return this.runLabelMutation({
      dryRun: flags['dry-run'],
      exclude: flags.exclude,
      include: flags.include,
      languages: flags.language,
      newPath: args['new-prefix'],
      oldPath: args['old-prefix'],
      operation: 'move',
      overwrite: flags.overwrite,
      write: flags.write,
    })
  }
}
