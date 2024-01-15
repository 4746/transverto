import {Flags} from '@oclif/core'
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";

import {CTV_CACHE_ENGINE_FILE} from "../shared/constants.js";
import {Helper} from "../shared/helper.js";
import {LabelBaseCommand} from "../shared/label-base.command.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev cache
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev cache --help
 */
export default class Cache extends LabelBaseCommand<typeof Cache> {
  static description = 'Cache management command. \nCache dir: <%= config.cacheDir %>'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --help',
  ]

  static flags = {
    clear: Flags.boolean({char: 'c'}),
  }

  private cacheEngineFile: string;

  public async run(): Promise<void> {
    const {flags} = await this.parse(Cache)

    this.cacheEngineFile = path.join(this.config.cacheDir, CTV_CACHE_ENGINE_FILE);

    if (flags.clear) {
      await this.cacheClear();
      this.log(chalk.green(`Cache cleared successfully.`));
    }

    const size = await this.cacheSize();

    this.log(chalk.cyan(`Cache path: ${this.cacheEngineFile}`));
    this.log(chalk.cyan(`Size: ${size}KB`));
  }

  private async cacheClear() {
    return Helper.writeOrCreateJsonFile({}, this.cacheEngineFile);
  }

  private async cacheSize() {
    const stat = fs.statSync(this.cacheEngineFile, {throwIfNoEntry: false});

    if (!stat) {
      await this.cacheClear();
      return 0;
    }

    if (stat.isFile()) {
      return Math.round(stat.size / 1024);
    }

    this.error(chalk.red(`Error path cache path: ${this.cacheEngineFile}`));
  }
}
