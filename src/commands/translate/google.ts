import {Args, Flags} from '@oclif/core'

import {GoogleEngine} from "../../shared/engines/google.engine.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {TGoogleLangCode, TGoogleLangCodeExtend} from "../../shared/lang.google.js";

/**
 * node --loader ts-node/esm ./bin/dev translate:google --help
 * node --loader ts-node/esm ./bin/dev translate:google Text
 * node --loader ts-node/esm ./bin/dev translate:google Text -tuk
 */
export default class TranslateGoogle extends LabelBaseCommand<typeof TranslateGoogle> {
  static args = {
    text: Args.string({description: 'The text to be translated, can\'t be blank. The maximum text length is 1000.', required: true}),
  }

  static description = 'A simple and free API for Google Translator.'

  static enableJsonFlag = true;

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> Text -tuk',
    '<%= config.bin %> <%= command.id %> Text -tuk --json',
  ]

  static flags = {
    from: Flags.string({char: 'f', default: GoogleEngine.defaultFrom, description: 'The language code of source text.'}),
    to: Flags.string({char: 't', default: GoogleEngine.defaultTo, description: 'The language in which the text should be translated.'}),
  }

  static hidden = true;

  /**
   * source language code. `auto-detect` by default.
   */
  private from: TGoogleLangCodeExtend;
  /**
   * content to be translated
   */
  private text: string;
  /**
   * target language code. `en` by default.
   */
  private to: TGoogleLangCode;

  public async run(): Promise<NonNullable<object> | void> {
    const {args, flags} = await this.parse(TranslateGoogle)

    await this.readCliConfig()

    this.text = args.text.trim();
    this.from = (flags.from || 'auto-detect') as TGoogleLangCodeExtend;
    this.to = (flags.to || 'en') as TGoogleLangCode;

    const be = new GoogleEngine({...this.cliConfig.google}, flags.userAgent || this.cliConfig.userAgent);

    const response = await be.translate({
      from: this.from,
      text: this.text,
      to: this.to,
    })

    if (this.jsonEnabled()) {
      return response;
    }

    this.log(response.trans);
  }
}
