import {Args, Flags} from '@oclif/core'
import chalk from "chalk";

import {Helper} from "../../shared/helper.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {UTIL} from "../../shared/util.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:replace hello.world
 */
export default class LabelReplace extends LabelBaseCommand<typeof LabelReplace> {
  static args = {
    label: Args.string({
      description: 'A label key',
      required: true
    }),
  }

  static description = 'Replace the label'

  static examples = [
    '<%= config.bin %> <%= command.id %> --help',
    '<%= config.bin %> <%= command.id %> hello.world -t="Hello world!!!"',
    '<%= config.bin %> <%= command.id %> hello.world -t="Hello world!!!" -fen',
  ]

  static flags = {
    langCode: Flags.string({
      char: 'f',
      default: null,
      description: 'The language code of source text.',
      multiple: false,
      requiredOrDefaulted: true,
    }),
    translation: Flags.string({
      char: 't',
      description: 'The translation text.',
      required: true,
    }),
  }

  private label: string;
  private langCode: string;
  private translation: string;

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LabelReplace)

    await this.readCliConfig();

    this.label = await this.getLabelValidationOrInput({
      label: args.label,
      labelValidation: this.cliConfig.labelValidation
    });

    this.langCode = await this.getLangCode(this.cliConfig.languages, flags.langCode);

    this.translation = await this.getTranslation(flags.translation, this.langCode);

    const mapLang =  await this.getLangTranslation(this.langCode);

    let isChange = false;
    if (this.label in mapLang.translateFlatten) {
      mapLang.translate = UTIL.replacePropertyPath(mapLang.translate, this.label, flags.translation);
      isChange = true;
    } else {
      this.log(chalk.red(`Label not found.`));
    }

    if (isChange) {
      await Helper.writeOrCreateJsonFile(mapLang.translate, mapLang.file);

      this.log(chalk.green(`Label changed successfully.`));
    }
  }
}
