import {Args, Command} from '@oclif/core'

export default class Label extends Command {
  static args = {
    add: Args.string({description: 'Adds a new label.', required: false}),
    delete: Args.string({description: 'Deletes a label.', required: false}),
    get: Args.string({description: 'Retrieves the labels.', required: false}),
    replace: Args.string({description: 'Replaces a label with the given value.', required: false}),
    sync: Args.string({description: 'A command to update labels synchronously.', required: false}),
  }

  static description = 'Label management command.'

  async run(): Promise<void> {
    // const {args} = await this.parse(Label)
  }
}
