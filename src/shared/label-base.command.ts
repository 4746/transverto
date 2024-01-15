import {input, select} from "@inquirer/prompts";
import {Command} from '@oclif/core'
import chalk from "chalk";
import {readJson} from "fs-extra/esm";
import fs from "node:fs";
import path from "node:path";

import {CONFIG_DEFAULT, IConfig, LANG_CODE_DEFAULT} from "./config.js";
import {CTV_CONFIG_FILE_NAME} from "./constants.js";
import {ITranslation, TTranslation} from "./entities/translate.js";
import {Helper} from "./helper.js";
import {UTIL} from "./util.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export abstract class LabelBaseCommand<T extends typeof Command> extends Command {
  protected cliConfig!: IConfig;

  /**
   * Retrieves a label for validation or input based on provided parameters.
   *
   * @async
   * @param {Object} options - The options object.
   * @param {string} options.label - The label to be validated or entered.
   * @param {string} options.labelValidation - The regular expression pattern used to validate the label.
   * @param {boolean} clearPromptOnDone - Determines if the prompt should be cleared after input is received (default: true).
   * @returns {Promise<string>} The validated label or entered label.
   */
  protected async getLabelValidationOrInput({label, labelValidation}: {label?: string, labelValidation?: string}, clearPromptOnDone: boolean = true): Promise<string> {
    if (UTIL.isString(label) && UTIL.isString(labelValidation) && (new RegExp(labelValidation, 'gm')).test(label)) {
      return label;
    }

    return input({
      default: UTIL.isString(label) ? label : null,
      message: `Enter label:`,
      validate: (v: string) => {
        let isValid: boolean;
        // eslint-disable-next-line
        if (v && UTIL.isString(labelValidation)) {
          isValid = (new RegExp(labelValidation, 's')).test(v);
        } else {
          isValid = UTIL.isString(label) && label.length > 0 && label.length < 500;
        }

        if (isValid) {
          return true;
        }

        return 'Label name is not correct';
      }
    }, {
      clearPromptOnDone,
    });
  }

  protected async getLangCode(languages: string[], fromLangCode?: string, langCodeDefault?: string) {
    if (!Array.isArray(languages) || languages.length === 0) {
      throw new Error('Language code is not specified in the settings file.')
    }

    let language = fromLangCode || langCodeDefault;

    if (language && !languages.includes(language)) {
      throw new Error('The specified language code does not exist in the settings.')
    }

    if (!language) {
      language = await select({
        choices: languages.map(
          (lang: string) => ({name: lang, value: lang})
        ),
        default: LANG_CODE_DEFAULT,
        message: 'Choose a language code:'
      }, {
        clearPromptOnDone: true,
      })
    }

    return language
  }

  protected async getLangTranslation(langCode: string): Promise<ITranslation> {
    const file = Helper.getPathLanguageFile(langCode, this.cliConfig.basePath);

    let translate = {};
    try {
      translate = await Helper.readJsonFile(file);
    } catch {
      this.log(chalk.yellow(`Error reading file [${file}]`))
    }

    return {
      code: langCode,
      file,
      translate,
      translateFlatten: UTIL.flattenObject(translate)
    };
  }

  protected async getTranslation(text: string, langCode: string, clearPromptOnDone = true) {
    if (text) {
      return text;
    }

    return input({
      message: `Enter translation [${langCode}]:`,
      validate: (v: string) => {
        const isValid = UTIL.isString(v) && v.length > 0;

        if (isValid && v.length > 1000) {
          return 'The maximum number of characters exceeds 1000 characters';
        }

        if (isValid) {
          return true;
        }

        return 'Label name is not correct';
      }
    }, {
      clearPromptOnDone,
    })
  }

  protected async getTranslationLanguages(): Promise<TTranslation> {
    const mapLang: TTranslation = {};

    let langCode: string;

    for (langCode of this.cliConfig.languages) {
      mapLang[langCode] = await this.getLangTranslation(langCode);
    }

    return mapLang;
  }

  protected async makeTranslationEnum(mapLang: ITranslation) {
    const {basePathEnum, languages, nameEnum} = {...this.cliConfig};

    const data = [
      '/* eslint-disable */',
      `/**\n * DO NOT EDIT!\n * THIS IS AUTOMATICALLY GENERATED FILE\n * run ${this.config.pjson.name} label:sync \n */`,
      '',
      `export enum E${nameEnum} {`
    ];

    for (const lang of languages) {
      data.push(`  ${lang.toUpperCase()} = '${lang}',`);
    }

    data.push('}', '');

    const list = Object.keys(mapLang.translateFlatten)
      .sort()
      .map((label, k) => {
        if (k === 0) {
          return `'${label}'`;
        }

        return `  | '${label}'`;
      })

    data.push(
      `export type T${nameEnum} = ${list.join('\n')};`,
      '',
      `export type T${nameEnum}OrString  = T${nameEnum} | string;`,
      `export type T${nameEnum}OrNever  = T${nameEnum} | never;`,
      ''
    );

    const stat = fs.statSync(basePathEnum, {throwIfNoEntry: false});

    if (!stat) {
      await fs.promises.mkdir(path.dirname(basePathEnum), {recursive: true});
    } else if (!stat.isFile()) {
      this.error(`Error path [basePathEnum]: ${basePathEnum}`);
    }

    await fs.promises.writeFile(basePathEnum, data.join('\n'),{ flag: "w" });
  }

  /**
   * Reads the CLI configuration file `(.ctv.config.json)` and merges it with the default configuration.
   *
   * @returns {Promise<IConfig>} A promise that resolves to the merged configuration.
   */
  protected async readCliConfig(): Promise<IConfig> {
    if (!this.cliConfig) {
      const conf = await readJson(path.join(process.cwd(), CTV_CONFIG_FILE_NAME));

      this.cliConfig = UTIL.mergeDeep(CONFIG_DEFAULT, conf) as IConfig;
    }

    return this.cliConfig
  }
}
