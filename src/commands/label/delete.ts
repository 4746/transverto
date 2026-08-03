import {Args, Flags} from '@oclif/core'

import type {ILabelMutationReport} from '../../shared/entities/label-mutation.js'

import {LabelMutationCommand, labelMutationFlags} from '../../shared/label-mutation.command.js'

export default class LabelDelete extends LabelMutationCommand<typeof LabelDelete> {
  static args = {
    pattern: Args.string({
      description: 'exact key, branch prefix, or edge-wildcard key pattern',
      required: true,
    }),
  }

  static description = 'Safely delete translation keys across configured languages'
  static enableJsonFlag = true
  static examples = [
    '<%= config.bin %> <%= command.id %> home.legacy --dry-run',
    '<%= config.bin %> <%= command.id %> "*.deprecated" --language en --language uk --dry-run --json',
    '<%= config.bin %> <%= command.id %> "admin.*" --force',
  ]

  static flags = {
    ...labelMutationFlags,
    force: Flags.boolean({char: 'f', description: 'apply without interactive confirmation'}),
  }

  public async run(): Promise<ILabelMutationReport | void> {
    const {args, flags} = await this.parse(LabelDelete)
    return this.runLabelMutation({
      dryRun: flags['dry-run'],
      exclude: flags.exclude,
      force: flags.force,
      include: flags.include,
      languages: flags.language,
      oldPath: args.pattern,
      operation: 'delete',
      write: flags.write,
    })
  }
}
