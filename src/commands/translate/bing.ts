import {Args, Flags} from '@oclif/core'

import {BingEngine} from "../../shared/engines/bing.engine.js";
import {IBingTranslationResult} from "../../shared/entities/bing.config.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {TBingLangCode, TBingLangCodeExtend} from "../../shared/lang.bing.js";


/**
 * Represents a TranslateBing command that extends the Command class.
 *
 * node --loader ts-node/esm ./bin/dev translate:bing --help
 * node --loader ts-node ./bin/dev translate:bing --help
 * node --loader ts-node ./bin/dev translate:bing
 * node --loader ts-node ./bin/dev translate:bing Text
 */
export default class TranslateBing extends LabelBaseCommand<typeof TranslateBing> {
  static args = {
    text: Args.string({description: 'The text to be translated, can\'t be blank. The maximum text length is 1000.', required: true}),
  }

  static description = 'A simple and free API for Bing Translator.'

  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> Hello',
    '<%= config.bin %> <%= command.id %> Hello --json',
    '<%= config.bin %> <%= command.id %> --help',
  ]

  static flags = {
    correct: Flags.boolean({char: 'c', default: false, description: '[default: false] Whether to correct the input text.'}),
    from: Flags.string({char: 'f', default: BingEngine.defaultFrom, description: 'The language code of source text.'}),
    raw: Flags.boolean({char: 'r', default: false, description: '[default: false] Whether the translation result contains raw response from Bing API.'}),
    to: Flags.string({char: 't', default: BingEngine.defaultTo, description: 'The language in which the text should be translated.'}),
    userAgent: Flags.string({default: null, description: 'The header value of `User-Agent` used in API requests.'}),
  }

  static hidden = true;

  /**
   * source language code. `auto-detect` by default.
   */
  private from: TBingLangCodeExtend;
  /**
   * content to be translated
   */
  private text: string;
  /**
   * target language code. `en` by default.
   */
  private to: TBingLangCode;

  public async run(): Promise<IBingTranslationResult | void> {
    const {args, flags} = await this.parse(TranslateBing)

    await this.readCliConfig()

    this.text = args.text.trim();
    this.from = (flags.from || 'auto-detect') as TBingLangCodeExtend;
    this.to = (flags.to || 'en') as TBingLangCode;

    const be = new BingEngine({...this.cliConfig.bing, correct: flags.correct, raw: flags.raw, userAgent: flags.userAgent});

    const tr = await be.translate(args.text, this.to, this.from);

    if (this.jsonEnabled()) {
      return tr;
    }

    this.log(tr.translation);
  }
}
