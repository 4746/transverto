import {Got, got} from "got";

import {DEFAULT_USER_AGENT} from "../constants.js";
import {ITerraConfig, ITerraTranslationResult} from "../entities/terra.config.js";
import {BaseEngine, IParamTranslateText} from "../entities/translation.engine.js";
import {TERRA_LANG_MAP, TTerraLangCode, TTerraLangCodeExtend} from "../lang.terra.js";

export class TerraEngine implements BaseEngine {
  static readonly defaultFrom: TTerraLangCode = null;
  static readonly defaultTo: TTerraLangCode = 'en';
  static readonly MAX_RETRY_COUNT = 3;

  private client: Got;

  private readonly userAgent: string;

  constructor(private readonly config: ITerraConfig) {
    this.userAgent = DEFAULT_USER_AGENT ?? config.userAgent;

    this.client = got.extend({
      headers: {
        'Accept-Language': 'en-US,en',
        'User-Agent': this.config?.userAgent || this.userAgent,
        referer: 'https://translate.terraprint.co'
      },
      retry: {
        limit: TerraEngine.MAX_RETRY_COUNT,
        methods: ['POST']
      },
      timeout: {
        request: 1000,
        response: 1000,
      },
    });
  }

  static getLangCode(lang: TTerraLangCode | string): string {
    if (!lang || typeof lang !== 'string') {
      return null;
    }

    if (lang in TERRA_LANG_MAP) {
      return lang;
    }

    lang = lang.toLowerCase();

    if (lang in TERRA_LANG_MAP) {
      return lang;
    }

    return Object.keys(TERRA_LANG_MAP).find((code: TTerraLangCode | string) => code.toLowerCase() === lang)
  }

  /**
   * @param text Text for translation
   * @param toLangCode Translation language code
   * @param fromLangCode Original language code
   */
  public async translate(text: string, toLangCode?: TTerraLangCodeExtend, fromLangCode?: TTerraLangCodeExtend): Promise<ITerraTranslationResult> {

    const form = new FormData();
    form.set('q', text);

    form.set('target', toLangCode);
    form.set('format', 'text');

    if (this.config.fromLangCode) {
      form.set('source', this.config.fromLangCode);
    } else if (fromLangCode) {
      form.set('source', fromLangCode);
    } else {
      throw new Error('[E00213] Not `fromLangCode`');
    }

    if (this.config.apiKey) {
      form.set('api_key', this.config.apiKey);
    }

    const response = await this.client.post<ITerraTranslationResult>('https://translate.terraprint.co/translate', {
      body: form,
      maxRedirects: 3,
      responseType: 'json',
    });

    const {body, statusCode} = response;
    if (statusCode !== 200) {
      throw new Error(`[E00213] Response status: ${statusCode}\nResponse body  : ${JSON.stringify(body)}`)
    }

    return body;
  }

  async translateText({from, text, to}: IParamTranslateText) {
      const response = await this.translate(text, to, from);

      return response.translatedText
  }
}
