import {ExtendOptions, Got, got} from "got";

import {DEFAULT_USER_AGENT} from "../constants.js";
import {IGoogleConfig} from "../entities/google.config.js";
import {BaseEngine, IParamTranslateText} from "../entities/translation.engine.js";
import {
  GOOGLE_DOMAIN,
  GOOGLE_LANG_MAP,
  TGoogleDomain,
  TGoogleLangCode,
  TGoogleLangCodeExtend,
  TGoogleType
} from "../lang.google.js";
import {UTIL} from "../util.js";

export class GoogleEngine implements BaseEngine {
  static readonly defaultFrom: TGoogleLangCodeExtend = 'auto';
  static readonly defaultService: TGoogleDomain = 'translate.google.com';
  static readonly defaultTo: TGoogleLangCode = 'en';
  static readonly MAX_RETRY_COUNT = 2;

  private client: Got;
  private readonly cookies: Record<string, string> = {};

  private readonly parserType: TGoogleType;

  private reqId: number;
  private readonly serviceUrl: TGoogleDomain;
  private readonly userAgent: string;

  constructor(private readonly config: IGoogleConfig, userAgent?: string) {
    this.userAgent = DEFAULT_USER_AGENT ?? userAgent;

    this.serviceUrl = config?.service || GoogleEngine.defaultService;
    this.parserType = config?.type || 'rpc';

    this.reqId = Number(Date.now().toString().slice(6, 13));

    this.client = got.extend({
      cache: false,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        "referer": `https://${this.serviceUrl}/`,
        'user-agent': this.userAgent
      },
      hooks: {
        afterResponse: [
          (response) => {
            if ('set-cookie' in response.headers) {
              response.headers['set-cookie'].forEach((cookie: string) => {
                const raw = this.parseRawCookie(cookie);
                if (raw) {
                  this.cookies[raw.name] = raw.value;
                }
              })
            }

            return response;
          }
        ],
        beforeError: [],
        beforeRedirect: [],
        beforeRequest: [
          (options) => {
            const cookies: string[] = [];
            if (cookies.length > 0) {
              options.headers['set-cookie'] = cookies;
            }
            // options.headers.secret = options.context.secret;
          }
        ],
        beforeRetry: [],
        init: []
      },
      http2: true,
      retry: {
        limit: GoogleEngine.MAX_RETRY_COUNT,
        methods: ['GET', 'POST']
      }
    } as ExtendOptions);
  }

  static isSupported(lang: TGoogleLangCodeExtend): boolean {
    return lang in GOOGLE_LANG_MAP;
  }

  async translate(param: IParamTranslateText) {
    if (!GoogleEngine.isSupported(param.to)) {
      throw new Error(`Not support lang ${param.to}`);
    }

    if (param.from !== 'auto' && !GoogleEngine.isSupported(param.from)) {
      throw new Error(`Not support lang ${param.from}`);
    }

    if (this.parserType === "api1") {
      return this.translateAPI1(param);
    }

    if (this.parserType === "api2") {
      return this.translateAPI2(param);
    }

    if (this.parserType === "api3") {
      return this.translateAPI3(param);
    }

    if (this.parserType === "api4") {
      return this.translateAPI4(param);
    }

    if (this.parserType === "rpc") {
      return this.translateRPC(param);
    }

    throw new Error(`Not support type: ${this.parserType}`);
  }

  async translateAPI1(param: IParamTranslateText) {
    const {body, statusCode} = await this.client.get('https://translate.googleapis.com/translate_a/single', {
      followRedirect: false,
      responseType: 'json',
      searchParams: new URLSearchParams([
        ['client', 'gtx'],
        ['dt', 't'],
        ['q', param.text],
        ['sl', param.from],
        ['tl', param.to],
      ])
    });

    if (statusCode === 0) {
      throw new Error('connection server');
    }

    if (statusCode > 400) {
      return null;
    }

    // [[["Текст","Text",null,null,3,null,null,[[]],[[["2e8de74564aec87fb81cb0340a661858","tea_SouthSlavicA_en2bebsbghrsrsluk_2022q2.md"]]]]],null,"en",null,null,null,1,[],[["en"],null,[1],["en"]]]
    let trans: string;

    try {
      [[trans,]] = (body as [string[]][]).shift();
    } catch (reason) {
      console.log([body])
      throw reason;
    }

    return {orig: param.text, trans}
  }

  async translateAPI2(param: IParamTranslateText) {
    const {body, statusCode} = await this.client.get('https://clients5.google.com/translate_a/t', {
      followRedirect: false,
      responseType: 'json',
      searchParams: new URLSearchParams([
        ['client', 'dict-chrome-ex'],
        ['q', param.text],
        ['sl', param.from],
        ['tl', param.to],
      ])
    });

    if (statusCode === 0) {
      throw new Error('connection server');
    }

    if (statusCode > 400) {
      return null;
    }

    // [ [ 'Текст', 'en' ]]
    let trans: string;
    let lang: string;

    try {
      [[trans, lang,]] = body as [string[]];
    } catch (reason) {
      console.log([body])
      throw reason;
    }

    return {lang, orig: param.text, trans}
  }

  async translateAPI3(param: IParamTranslateText) {
    const {body, statusCode} = await this.client.get<NonNullable<object>>('https://translate.googleapis.com/translate_a/single', {
      followRedirect: false,
      responseType: 'json',
      searchParams: new URLSearchParams([
        ['client', 'gtx'],
        ['source', 'bubble'],
        ['dj', '1'],
        ['q', param.text],
        ['sl', param.from],
        ['tl', param.to],
        ['hl', param.to],
        ['dt', 't'],
        ['dt', 'bd'],
        ['dt', 'ex'],
        ['dt', 'ld'],
        ['dt', 'md'],
        ['dt', 'qca'],
        ['dt', 'rw'],
        ['dt', 'rm'],
        ['dt', 'ss'],
        ['dt', 'at'],
      ])
    });

    if (statusCode === 0) {
      throw new Error('connection server');
    }

    if (statusCode > 400) {
      return null;
    }

    /// {
    //   "sentences":[
    //     {
    //       "trans":"Напишіть двом розробникам",
    //       "orig":"Text two developers",
    //       "backend":3,
    //       "model_specification":[
    //         { }
    //       ],
    //       "translation_engine_debug_info":[
    //         {
    //           "model_tracking":{
    //             "checkpoint_md5":"2e8de74564aec87fb81cb0340a661858",
    //             "launch_doc":"tea_SouthSlavicA_en2bebsbghrsrsluk_2022q2.md"
    //           }
    //         }
    //       ]
    //     },
    //     {
    //       "translit":"Napyshitʹ dvom rozrobnykam"
    //     }
    //   ],
    //   "src":"en",
    //   "alternative_translations":[
    //     {
    //       "src_phrase":"Text two developers",
    //       "alternative":[
    //         {
    //           "word_postproc":"Напишіть двом розробникам",
    //           "score":0,
    //           "has_preceding_space":true,
    //           "attach_to_next_token":false,
    //           "backends":[
    //             3
    //           ],
    //           "backend_infos":[
    //             {
    //               "backend":3
    //             }
    //           ]
    //         },
    //         {
    //           "word_postproc":"Надішліть текстове повідомлення двом розробникам",
    //           "score":0,
    //           "has_preceding_space":true,
    //           "attach_to_next_token":false,
    //           "backends":[
    //             8
    //           ]
    //         }
    //       ],
    //       "srcunicodeoffsets":[
    //         {
    //           "begin":0,
    //           "end":19
    //         }
    //       ],
    //       "raw_src_segment":"Text two developers",
    //       "start_pos":0,
    //       "end_pos":0
    //     }
    //   ],
    //   "confidence":1,
    //   "spell":{ },
    //   "ld_result":{
    //     "srclangs":[
    //       "en"
    //     ],
    //     "srclangs_confidences":[
    //       1
    //     ],
    //     "extended_srclangs":[
    //       "en"
    //     ]
    //   }
    // }
    let trans: string;
    let src: string;

    try {
      if ('sentences' in body && Array.isArray(body.sentences)) {
        [{trans},] = body.sentences;
      }

      if ('src' in body) {
        src = body.src as string;
      }
    } catch (reason) {
      console.log([body])
      throw reason;
    }

    return {lang: src, orig: param.text, trans}
  }

  async translateAPI4(param: IParamTranslateText) {
    const {body, statusCode} = await this.client.get<NonNullable<object>>('https://translate.googleapis.com/translate_a/single', {
      followRedirect: false,
      responseType: 'json',
      searchParams: new URLSearchParams([
        ['client', 'gtx'],
        ['source', 'input'],
        ['dj', '1'],
        ['q', param.text],
        ['sl', param.from],
        ['tl', param.to],
        ['dt', 't'],
        ['dt', 'bd'],
      ])
    });

    if (statusCode === 0) {
      throw new Error('connection server');
    }

    if (statusCode > 400) {
      return null;
    }

    // {
    //   "sentences":[
    //     {
    //       "trans":"Напишіть двом розробникам",
    //       "orig":"Text two developers",
    //       "backend":3,
    //       "model_specification":[
    //         { }
    //       ],
    //       "translation_engine_debug_info":[
    //         {
    //           "model_tracking":{
    //             "checkpoint_md5":"2e8de74564aec87fb81cb0340a661858",
    //             "launch_doc":"tea_SouthSlavicA_en2bebsbghrsrsluk_2022q2.md"
    //           }
    //         }
    //       ]
    //     }
    //   ],
    //   "src":"en",
    //   "confidence":1,
    //   "spell":{ },
    //   "ld_result":{
    //     "srclangs":[
    //       "en"
    //     ],
    //     "srclangs_confidences":[
    //       1
    //     ],
    //     "extended_srclangs":[
    //       "en"
    //     ]
    //   }
    // }

    let trans: string;
    let src: string;

    try {
      if ('sentences' in body && Array.isArray(body.sentences)) {
        [{trans},] = body.sentences;
      }

      if ('src' in body) {
        src = body.src as string;
      }
    } catch (reason) {
      console.log([body])
      throw reason;
    }

    return {lang: src, orig: param.text, trans}
  }

  /**
   * Google Translates RPC API
   */
  async translateRPC(param: IParamTranslateText) {
    const text = param.text.replaceAll('"', " ");
    // rpcids = 'AVdN8';
    // dataString = 'f.req=' + encodeURI(`[[["${rpcids}","[\\"${text}\\",\\"${param.text}\\",\\"${param.from}\\"]",null,"generic"]]]`);

    const rpcids = 'MkEWBc';
    const dataString = 'f.req=' + encodeURI(`[[["${rpcids}","[[\\"${text}\\",\\"${param.from}\\",\\"${param.to}\\",1],[]]",null,"generic"]]]`);

    if (!GOOGLE_DOMAIN.includes(this.serviceUrl)) {
      throw new Error(`Not support domain: ${this.serviceUrl}`);
    }

    const {body, statusCode} = await this.client.post(`https://${this.serviceUrl}/_/TranslateWebserverUi/data/batchexecute`, {
      body: dataString,
      cache: false,
      headers: {
        Accept: '*/*',
      },
      searchParams: new URLSearchParams([
        ['rpcids', rpcids],
        ['source-path', '/'],
        // ['f.sid', '2583840604490340159'],
        ['bl', 'boq_translate-webserver_20240115.08_p0'],
        // ['hl', param.to],
        ['soc-app', '1'],
        ['soc-platform', '1'],
        ['soc-device', '1'],
        ['_reqid', this.getReqId().toString()],
        ['rt', 'c'],
      ])
    });

    if (statusCode === 0) {
      throw new Error('connection server');
    }

    if (statusCode > 400) {
      return null;
    }

    // )]}'
    //
    // 507
    // [["wrb.fr","MkEWBc","[[null,null,\"en\",[[[0,[[[null,20]],[true]]]],20],[[\"Two.\",null,null,20]],null,[\"Two.\",\"auto\",\"uk\",true]],[[[null,\"Dvoye.\",null,null,null,[[\"Двоє.\",null,null,null,[[\"Двоє.\",[5],[]],[\"Двоє.\",[11],[]]]]],null,null,null,[]]],\"uk\",1,\"en\",[\"Two developer there.\",\"auto\",\"uk\",true]],\"en\"]",null,null,null,"generic"],["di",24],["af.httprm",23,"8141690242435471324",27]]
    // 25
    // [["e",4,null,null,595]]

    let transliterate: string;
    let trans: string;
    let lang: string;

    try {
      const lines: string[] = body.split('\n');
      const line = lines.find((ln) => ln.includes(`"${rpcids}"`));

      const data = JSON.parse(JSON.parse(line).shift()[2])

      if (Array.isArray(data) && data.length > 0) {
        trans = UTIL.getNestedValue(data, '1.0.0.5.0.0') as string;

        transliterate = UTIL.getNestedValue(data, '1.0.0.1') as string;

        if (!param.from || param.from === 'auto') {
          lang = UTIL.getNestedValue(data, '2') as string;
          if (!lang) {
            lang = UTIL.getNestedValue(data, '1.0.0.3') as string;
          }

          if (!lang) {
            lang = UTIL.getNestedValue(data, '1.3') as string;
          }
        } else {
          lang = param.from;
        }
      }
    } catch (reason) {
      console.log([reason])
      return null;
    }

    return {lang, orig: param.text, trans, transliterate}
  }

  async translateText(param: IParamTranslateText): Promise<string> {
    const data = await this.translate(param);

    return data.trans;
  }

  private getReqId() {
    this.reqId += 100000;
    return this.reqId;
  }

  private parseRawCookie(raw: string) {
    const [name, ...value] = raw.split(';')
      .shift()
      .split('=')

    if (!name) {
      return null;
    }

    let sep = '';
    if (value.length > 1) {
      sep='=';
    }

    return {
      name, value: value.join(sep)
    };
  }
}
