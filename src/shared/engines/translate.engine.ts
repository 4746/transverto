import {createHash} from "node:crypto";
import path from "node:path";

import {IConfig} from "../config.js";
import {CTV_CACHE_ENGINE_FILE} from "../constants.js";
import {BaseEngine, IParamTranslateText} from "../entities/translation.engine.js";
import {Helper} from "../helper.js";
import {BingEngine} from "./bing.engine.js";
import {TerraEngine} from "./terra.engine.js";

let CACHE_TRANSLATE: Record<string, string>;

export class TranslateEngine implements BaseEngine {
  private readonly cacheEngineFile: string;

  private engine: BaseEngine;
  private readonly engineUseCache: boolean;

  constructor(config: IConfig, cacheDir?: string) {
    switch (config?.engine) {
      case 'bing':
        this.engine = new BingEngine(config.bing)
        break;
      case 'terra':
        this.engine = new TerraEngine(config.terra)
        break;
      default:
        throw new Error(`The translation "engine" is not supported.`)
    }

    this.engineUseCache = config.engineUseCache && cacheDir;

    this.cacheEngineFile = path.join(cacheDir, CTV_CACHE_ENGINE_FILE);
  }

  async translateText({from, text, to}: IParamTranslateText) {
    if (!CACHE_TRANSLATE) {
      try {
        CACHE_TRANSLATE = this.engineUseCache ? await Helper.readJsonFile(this.cacheEngineFile) as Record<string, string> : {};
      } catch (reason) {
        CACHE_TRANSLATE = {};

        if (reason.code === 'ENOENT')  {
          await Helper.writeOrCreateJsonFile({}, this.cacheEngineFile);
        } else {
          throw reason
        }
      }
    }

    const key = createHash('sha256').update([text.toLowerCase(), to || ''].join('_')).digest('hex');

    if (key in CACHE_TRANSLATE) {
      return CACHE_TRANSLATE[key];
    }

    const translate = await this.engine.translateText({from, text, to});

    CACHE_TRANSLATE[key] = translate;

    if (this.engineUseCache) {
      await Helper.writeOrCreateJsonFile(CACHE_TRANSLATE, this.cacheEngineFile);
    }

    return translate;
  }
}
