import {Args, Flags} from '@oclif/core'

import type {ILabelMutationReport} from '../../shared/entities/label-mutation.js'

import {LabelMutationCommand, labelMutationFlags} from '../../shared/label-mutation.command.js'
import {resolveLabelRenameTarget} from '../../shared/label-rename-target.prompt.js'

export default class LabelRename extends LabelMutationCommand<typeof LabelRename> {
  static args = {
    old: Args.string({description: 'existing exact translation key', required: true}),
    new: Args.string({description: 'new exact translation key'}),
  }

  static description = 'Atomically rename a translation key across configured languages'
  static enableJsonFlag = true
  static examples = [
    '<%= config.bin %> <%= command.id %> home.title home.heading --dry-run',
    '<%= config.bin %> <%= command.id %> home.title home.heading --language uk --write',
    '<%= config.bin %> <%= command.id %> old.key new.key --overwrite --write --json',
  ]

  static flags = {
    ...labelMutationFlags,
    overwrite: Flags.boolean({description: 'replace existing target values'}),
  }

  public async run(): Promise<ILabelMutationReport | void> {
    const {args, flags} = await this.parse(LabelRename)
    let newPath: string
    try {
      newPath = await resolveLabelRenameTarget({
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        newPath: args.new,
        output: process.stdout,
      })
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }

    return this.runLabelMutation({
      dryRun: flags['dry-run'],
      exclude: flags.exclude,
      include: flags.include,
      languages: flags.language,
      newPath,
      oldPath: args.old,
      operation: 'rename',
      overwrite: flags.overwrite,
      write: flags.write,
    })
  }
}
