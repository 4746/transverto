import {Flags} from '@oclif/core'
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";

import {CONFIG_DEFAULT} from "../shared/config.js";
import {CTV_CONFIG_FILE_NAME} from "../shared/constants.js";
import {Helper} from "../shared/helper.js";
import {LabelBaseCommand} from "../shared/label-base.command.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev init
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev init --help
 */
export default class Init extends LabelBaseCommand<typeof Init> {
  static description = 'Create a default configuration file'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --help',
    '<%= config.bin %> <%= command.id %> --force',
  ]

  static flags = {
    force: Flags.boolean({char: 'f', description: 'overwrite an existing file'}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Init)

    const configPath = path.join(process.cwd(), CTV_CONFIG_FILE_NAME);

    const stat = fs.statSync(configPath, {throwIfNoEntry: false});

    if (stat) {
       if (!stat.isFile()) {
         return this.log(chalk.red(`Error path config path: ${configPath}`));
       } else if (!flags.force) {
         return this.log(chalk.yellow(`The settings file already exists: ${configPath}`));
       }
    }

    const data = {...CONFIG_DEFAULT};
    delete data.terra;

    await Helper.writeJsonFile(data, configPath);

    this.log(chalk.green(`Successfully!`));
    this.log(chalk.cyan(`Open the file "${CTV_CONFIG_FILE_NAME}" and set the appropriate parameters.`));
  }
}
