import {Got, RequestError, Response, got} from "got";

import {IBingConfig, IBingFetchConfig, IBingRequestBody, IBingTranslationResult} from "../entities/bing.config.js";
import {BaseEngine, IParamTranslateText} from "../entities/translation.engine.js";
import {BING_LANG_MAP, TBingLangCode, TBingLangCodeExtend} from "../lang.bing.js";
import {BaseEngineBing} from "./base-engine-bing.js";

export class BingEngine extends BaseEngineBing implements BaseEngine {
  static readonly defaultFrom: TBingLangCodeExtend = 'auto-detect';
  static readonly defaultTo: TBingLangCode = 'en';
  static readonly MAX_RETRY_COUNT = 3;

  private client: Got;

  private gConfig: Partial<IBingFetchConfig> = {};

  constructor(private readonly config: IBingConfig) {
    super();

    this.client = got.extend({
      headers: {
        referer: this.replaceSubdomain(this.websiteEndpoint),
        'user-agent': this.config?.userAgent || this.userAgent
      },
      retry: {
        limit: BingEngine.MAX_RETRY_COUNT,
        methods: ['GET', 'POST']
      },
    });
  }

  static getLangCode(lang: TBingLangCode | string) {
    if (!lang || typeof lang !== 'string') {
      return
    }

    if (lang in BING_LANG_MAP) {
      return lang;
    }

    lang = lang.toLowerCase();

    if (lang in BING_LANG_MAP) {
      return lang;
    }

    return Object.keys(BING_LANG_MAP).find((code: TBingLangCode | string) => code.toLowerCase() === lang)
  }

  public isCorrectable(lang: TBingLangCode | string): boolean {
    return this.correctableLangCode.includes(BingEngine.getLangCode(lang))
  }

  public async translate(text: string, toLangCode?: TBingLangCodeExtend, fromLangCode?: TBingLangCodeExtend): Promise<IBingTranslationResult> {
    if (!text || !(text = text.trim())) {
      throw new Error(`[E00104] Not text`);
    }

    fromLangCode = fromLangCode || BingEngine.defaultFrom;
    toLangCode = toLangCode || BingEngine.defaultTo;

    if (!this.isSupported(fromLangCode)) {
      throw new Error(`[E00105] The language '${fromLangCode}' is not supported!`)
    }

    if (!this.isSupported(toLangCode)) {
      throw new Error(`[E00106] The language '${toLangCode}' is not supported!`)
    }

    if (Object.keys(this.gConfig).length === 0) {
      this.gConfig = await this.makeFetchConfig()
    }

    if (this.isTokenExpired()) {
      this.gConfig = await this.makeFetchConfig()
    }

    const canUseEPT = text.length <= this.maxEPTTextLen && ([fromLangCode, toLangCode].every(lang => lang === 'auto-detect' || this.eptLangCode.includes(lang)))

    const subdomain = this.gConfig.subdomain || null;

    if (!canUseEPT) {
      // Currently 5000 is supported only in China
      // PENDING: dynamically re-generate local config.json when initializing?
      const maxTextLen = subdomain === 'cn'
        ? this.maxTextLenCN
        : this.maxTextLen

      if (text.length > maxTextLen) {
        throw new Error(`[E00120] The supported maximum text length is ${maxTextLen}. Please shorten the text.`)
      }
    }

    const requestURL = this.makeRequestURL(false, canUseEPT)
    const requestBody = this.makeRequestBody(false, text, fromLangCode, toLangCode)

    let body = await this.requestTranslate(
      requestURL,
      requestBody,
    )

    const translation = body[0].translations[0]
    const detectedLang = body[0].detectedLanguage

    const res: IBingTranslationResult = {
      language: {
        from: detectedLang.language,
        score: detectedLang.score,
        to: translation.to
      },
      text,
      translation: translation.text,
      userLang: fromLangCode
    }


    if (this.config.correct) {
      const correctLang = detectedLang.language
      const matcher = text.match(/"/g)

      const len = text.length + (matcher ? matcher.length : 0);
      // currently, there is a limit of 50 characters for correction service
      // and only parts of languages are supported
      // otherwise, it will return status code 400
      if (len <= this.maxCorrectableTextLen && this.isCorrectable(correctLang)) {
        body = await this.requestTranslate(
          this.makeRequestURL(true),
          this.makeRequestBody(true, text, correctLang),
        );

        res.correctedText = body && body.correctedText
      } else {
        console.warn(`[E00130] The detected language '${correctLang}' is not supported to be corrected or the length of text is more than ${this.maxCorrectableTextLen}.`)
      }
    }

    if (this.config.raw) {
      res.raw = body
    }

    return res;
  }

  async translateText({from, text, to}: IParamTranslateText) {
    const response = await this.translate(text, to, from);

    return response.translation || text;
  }

  private isSupported(lang: TBingLangCode | string): boolean {
    return BingEngine.getLangCode(lang) !== null
  }

  /**
   * Refetch global config if token is expired
   * @return {boolean} whether token is expired or not
   */
  private isTokenExpired(): boolean {
    if (Object.keys(this.gConfig).length === 0) {
      return true
    }

    const { tokenExpiryInterval, tokenTs } = this.gConfig

    return Date.now() - tokenTs > tokenExpiryInterval
  }

  private async makeFetchConfig(): Promise<IBingFetchConfig> {
    let subdomain = this.gConfig.subdomain || null;

    try {
      const {body, redirectUrls} = await this.client.get(this.replaceSubdomain(this.websiteEndpoint, subdomain));

      // when fetching for the second time, the subdomain may be unchanged
      if (redirectUrls && Array.isArray(redirectUrls) && redirectUrls.length > 0) {
        subdomain = redirectUrls.pop().href.match(/^https?:\/\/(\w+)\.bing\.com/)[1]
      }

      const IG = body.match(/IG:"([^"]+)"/)[1];
      const IID = body.match(/data-iid="([^"]+)"/)[1];

      const [key, token, tokenExpiryInterval]: [number, string, number] = JSON.parse(
        body.match(/params_AbusePreventionHelper\s?=\s?([^\]]+])/)[1]
      )

      const requiredFields = {
        IG,
        IID,
        key,
        token,
        tokenExpiryInterval,
        tokenTs: key
      }

      // check required fields
      for (const [field, value] of Object.entries(requiredFields)) {
        if (!value) {
          throw new Error(`[E00100] failed to fetch required field: \`${field}\``)
        }
      }

      return {
        ...requiredFields,
        // PENDING: reset count when value is large?
        count: 0,
        subdomain
      }
    } catch (reason) {
      console.log('[E00101] failed to fetch global config', reason);
      throw reason
    }
  }

  private makeRequestBody(isSpellCheck: boolean, text: string, fromLang: TBingLangCodeExtend, toLang?: TBingLangCodeExtend): IBingRequestBody {
    const { key, token } = this.gConfig
    const body: IBingRequestBody = {
      fromLang,
      key,
      text,
      token
    }

    if (!isSpellCheck) {
      toLang && (body.to = toLang)

      body.tryFetchingGenderDebiasedTranslations = true
    }

    return body
  }

  private makeRequestURL(isSpellCheck: boolean, useEPT?: boolean) {
    const {IG, IID, subdomain} = this.gConfig
    return this.replaceSubdomain(isSpellCheck ? this.spellCheckEndpoint : this.translateEndpoint, subdomain)
      + '&IG=' + IG
      + '&IID=' + (IID + (isSpellCheck || useEPT ? '.' + (++this.gConfig.count) : ''))
      + (
        isSpellCheck || !useEPT
          ? ''
          // PENDING: might no rate limit but some languages are not supported for now
          // (See also the `eptLangs` field in src/config.json)
          : '&ref=TThis' +
          '&edgepdftranslator=1'
      )
  }

  private replaceSubdomain(url: string, subdomain?: string): string {
    return url.replace('{s}', subdomain ? subdomain + '.' : '')
  }

  private async requestTranslate(requestURL: string, requestBody: IBingRequestBody) {
    const request = this.client.post<IResponseTranslate>(requestURL, {
      // agent: this.config.proxyAgents,
      // got will set CONTENT_TYPE as `application/x-www-form-urlencoded`
      form: requestBody,
      responseType: 'json',
    })

    let response: Response<IResponseTranslate>;

    let err: RequestError;
    let readableErrMsg: string;

    try {
      response = await request;
    } catch (reason) {
      console.log('--- catch ---');
      response = (err = reason).response;
    }

    const {body, statusCode, statusMessage} = response

    if (body.ShowCaptcha) {
      readableErrMsg = `[E00110] Sorry that bing translator seems to be asking for the captcha, please take care not to request too frequently.`
    } else if (body.StatusCode === 401 || statusCode === 401) {
      readableErrMsg = `[E00111] Translation limit exceeded. Please try it again later.`
    } else if (body.statusCode) {
      readableErrMsg = `[E00112] Something went wrong!`
    }

    if (readableErrMsg) {
      const responseMsg = `[E00113] Response status: ${statusCode} (${statusMessage})\nResponse body  : ${JSON.stringify(body)}`
      throw new Error(readableErrMsg + '\n' + responseMsg)
    }

    if (err) {
      console.log('--- 4 ---')
      const wrappedErr = new Error(`[E00102] Failed to request translation service`)
      wrappedErr.stack += '\n' + err.stack
      throw wrappedErr
    }

    return body;
  }
}

interface IResponseTranslate {
  ShowCaptcha?: boolean;
  StatusCode?: number;
  correctedText?: string;
  detectedLanguage?: {
    language: string;
    score: number;
  };
  statusCode?: number;
  translations?: IResponseTranslateItem[];
}

interface IResponseTranslateItem {
  translations: {
    sentLen: {
      srcSentLen: number[];
      transSentLen: number[];
    };
    text: string;
    to: string;
    transliteration: {
      script: string
      text: string,
    };
  }
}
