import {confirm} from "@inquirer/prompts";
import {Args, Flags} from '@oclif/core'
import chalk from "chalk";

import {Helper} from "../../shared/helper.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {UTIL} from "../../shared/util.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add hello.world  -f="en"
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:add hello.world  -f="en" -t "Hello World!"
 */
export default class LabelAdd extends LabelBaseCommand<typeof LabelAdd> {
  static args = {
    label: Args.string({default: null,  description: 'A label key', requiredOrDefaulted: true}),
  }

  static description = 'Add a new label';

  static examples = [
    `<%= config.bin %> <%= command.id %> "hello.world" -f="en"`,
    `<%= config.bin %> <%= command.id %> "hello.world" -f en -t "Hello World!"`,
    `<%= config.bin %> <%= command.id %> "hello.world" -fen -t "Hello World!"`,
    `<%= config.bin %> <%= command.id %> "hello.world" -t "Hello World!"`,
  ]

  static flags = {
    fromLangCode: Flags.string({
      char: 'f',
      default: null,
      description: 'The language code of source text.',
      multiple: false,
      requiredOrDefaulted: true,
    }),
    noAutoTranslate: Flags.boolean({aliases: ['no-auto-translate'], default: false}),
    silent: Flags.boolean({default: false}),
    translation: Flags.string({
      char: "t",
      default: null,
      description: 'Translation',
      multiple: false,
      requiredOrDefaulted: true,
    }),
  }

  /**
   * The language code of source text.
   */
  private fromLangCode: string;
  private label: string;
  private noAutoTranslate: boolean;
  private silent: boolean;
  private translation: string;

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LabelAdd);

    this.noAutoTranslate = flags.noAutoTranslate;
    this.silent = flags.silent;

    await this.readCliConfig();

    this.label = await this.getLabelValidationOrInput({
      label: args.label || null,
      labelValidation: this.cliConfig.labelValidation
    });

    this.fromLangCode = await this.getLangCode(this.cliConfig.languages, flags.fromLangCode, this.cliConfig.langCodeDefault);

    this.translation = await this.getTranslation(flags.translation, this.fromLangCode);

    const i18nPath = Helper.getPathLanguageFile(this.fromLangCode, this.cliConfig.basePath);

    let dataJson: NonNullable<object>;

    try {
      dataJson = await Helper.readJsonFile(i18nPath);
    } catch (reason) {
      // https://en.wikipedia.org/wiki/Errno.h
      if (reason?.code === 'ENOENT') {
        // No such file or directory
        const answer = await confirm({
          message: chalk.yellow(`The file [${i18nPath}] does not exist. \nCreate it?`),
        }, {
          clearPromptOnDone: true
        });

        if (!answer) {
          this.log(chalk.green(`The file [${i18nPath}] is missing!`))
          return  this.exit();
        }

        dataJson = {};
        await Helper.writeOrCreateJsonFile(dataJson, i18nPath);
      } else {
        throw reason;
      }
    }

    UTIL.setNestedValue(dataJson, this.label, this.translation);

    await Helper.writeOrCreateJsonFile(dataJson, i18nPath);

    const param = [`--silent`, `--noReport`];

    if (!this.noAutoTranslate) {
      param.push(`--auto-translate`)
    }

    if (!this.silent) {
      this.log(chalk.green(`Enter label:`), this.label);
      this.log(chalk.green(`Enter language:`), this.fromLangCode);
      this.log(chalk.green(`Enter translation:`), this.translation);
    }

    await this.config.runCommand('label:sync', param);

    this.log(chalk.cyan(`Done!`));
  }
}
