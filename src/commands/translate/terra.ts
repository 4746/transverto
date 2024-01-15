import {select} from "@inquirer/prompts";
import {Args, Flags} from '@oclif/core'

import {TerraEngine} from "../../shared/engines/terra.engine.js";
import {ITerraTranslationResult} from "../../shared/entities/terra.config.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {TERRA_LANG_MAP, TTerraLangCode, TTerraLangCodeExtend} from "../../shared/lang.terra.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev translate:terra "Hello World!" -tuk
 */
export default class TranslateTerra extends LabelBaseCommand<typeof TranslateTerra> {
  static args = {
    text: Args.string({description: 'Text for translation'}),
  }

  static description = 'describe the command here'
  public static enableJsonFlag = true;

  static examples = [
    `<%= config.bin %> <%= command.id %> --help`,
    `<%= config.bin %> <%= command.id %> "Hello World!" -f="en"`,
    `<%= config.bin %> <%= command.id %> "Hello World!" -fen -t "uk"`,
    `<%= config.bin %> <%= command.id %> "Hello World!" -tuk`,
    `<%= config.bin %> <%= command.id %> "Hello World!" -tuk --json`,
  ]

  static flags = {
    from: Flags.string({
      char: 'f',
      default: 'auto',
      description: 'Original language code',
      multiple: false,
      options: Object.keys(TERRA_LANG_MAP),
      requiredOrDefaulted: true,
    }),
    to: Flags.string({
      char: 't',
      description: 'Translation language code',
      options: Object.keys(TERRA_LANG_MAP),
    }),
  }

  static hidden = true;

  public async run(): Promise<ITerraTranslationResult | void> {
    const {args, flags} = await this.parse(TranslateTerra)

    const {terra} = await this.readCliConfig();
    const text = args.text || null;

    const from = await this.getLanguage(flags.from) as TTerraLangCodeExtend;
    const to = flags.to.toString() as TTerraLangCode;

    const engine = new TerraEngine(terra);

    const tr = await engine.translate(text, to, from);

    if (this.jsonEnabled()) {
      return tr;
    }

    this.log(tr.translatedText);
  }


  private async getLanguage(flagLanguage?: string) {
    let language = TerraEngine.getLangCode(flagLanguage);

    if (language) {
      this.log(`? Choose a language:  ${language}`)
    }

    if (!language) {
      language = await select({
        choices: Object.keys(TERRA_LANG_MAP).map(
          (lang: string) => ({name: TERRA_LANG_MAP[lang], value: lang})
        ),
        default: 'en',
        message: 'Choose a language:'
      })
    }

    return language
  }
}
