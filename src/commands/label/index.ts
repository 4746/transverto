import {Args, Command} from '@oclif/core'

export default class Label extends Command {
  static args = {
    add: Args.string({description: 'Adds a new label.', required: false}),
    delete: Args.string({description: 'Deletes a label.', required: false}),
    get: Args.string({description: 'Retrieves the labels.', required: false}),
    move: Args.string({description: 'Moves a label branch.', required: false}),
    rename: Args.string({description: 'Renames a label.', required: false}),
    replace: Args.string({description: 'Replaces a label with the given value.', required: false}),
    suggest: Args.string({description: 'Suggests English label keys.', required: false}),
    sync: Args.string({description: 'A command to update labels synchronously.', required: false}),
  }

  static description = 'Label management command.'

  async run(): Promise<void> {
    // const {args} = await this.parse(Label)
  }
}
