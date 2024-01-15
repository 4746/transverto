import {Flags, ux} from '@oclif/core'
import chalk from "chalk";
import {Listr} from 'listr2';

import {TranslateEngine} from "../../shared/engines/translate.engine.js";
import {ISyncRowReport} from "../../shared/entities/report.js";
import {TTranslation} from "../../shared/entities/translate.js";
import {Helper} from "../../shared/helper.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {UTIL} from "../../shared/util.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:sync
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:sync --help
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:sync --auto-translate
 */
export default class LabelSync extends LabelBaseCommand<typeof LabelSync> {
  static description = 'Synchronizing tags in translation files...'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    `<%= config.bin %> <%= command.id %> "hello.world" -f="en"`,
  ]

  static flags = {
    autoTranslate: Flags.boolean({aliases: ['auto-translate'], default: false}),
    noReport: Flags.boolean({aliases: ['no-report'], char: 'r', default: false}),
    silent: Flags.boolean({char: 's', default: false}),
  }

  private autoTranslate: boolean;

  private langCodePriority: Record<string, number>;
  private noReport: boolean;

  private repostRows: ISyncRowReport[] = [];
  private repostTableHeader: ISyncRowReport = {
    label: 'Label',
  };

  private silent: boolean;
  private translateEngine: TranslateEngine;

  public async run(): Promise<void> {
    const {flags} = await this.parse(LabelSync)

    this.noReport = flags.noReport;
    this.silent = flags.silent;

    this.autoTranslate = flags.autoTranslate;

    const tasks = new Listr<CtxTasks>([
      {
        task: async () => this.taskReadConfiguration(),
        title: 'Configuration settings',
      },
      {
        task: async (ctx) => this.taskReadLanguageFiles(ctx),
        title: 'Read language files',
      },
      {
        // skip: ctx => ctx.isSynchronized,
        task: async (ctx) => this.taskLabelAreSynchronized(ctx),
        title: 'Labels are synchronized',
      },
      {
        // skip: ctx => ctx.isSynchronized,
        task: async (ctx) => this.taskCreateTranslationEnum(ctx),
        title: 'Create translation Enum',
      }
    ], {
      concurrent: false,
      exitOnError: true,
      silentRendererCondition: this.silent
    });

    // tasks.add([])

    tasks.run()
      .then(() => {
        this.showReport();

        if (!this.silent) {
          this.log(chalk.cyan(`Done!`))
        }
      });
  }

  /**
   * Adds a report row to the report table.
   */
  private addReportRow(row: Record<string, string>) {
    const fill = {...this.repostTableHeader};
    Object.keys(fill).forEach(key => {
      fill[key] = '';
    });

    this.repostRows.push({
      ...fill,
      ...row,
    })
  }

  private createLangCodePriority(languages: string[]): Record<string, number> {
    const langCodePriority: [string, number][] = languages.map((code, idx) => {
      this.repostTableHeader[code] = '';
      return [code, idx];
    });

    return Object.fromEntries(
      (new Map(langCodePriority)).entries()
    );
  }

  private async flattenAddMissingKeys(sourceLangCode: string, targetLangCode: string, targetTranslate: Record<string, string|string[]>, sourceTranslate: Record<string, string|string[]>) {
    const added: Set<string> = new Set();
    for (const label in sourceTranslate) {
      if (label in targetTranslate) {
        continue;
      }

      added.add(label);

      targetTranslate[label] = await this.translateText(sourceTranslate[label], sourceLangCode, targetLangCode);

      this.addReportRow({
        label: label,
        [sourceLangCode]: '*',
        [targetLangCode]: '+'
      })
    }

    return added;
  }

  private showReport() {
    if (this.noReport) {
      return;
    }

    if (this.repostRows.length === 0) {
      return;
    }

    const mapRows: Map<string, ISyncRowReport> = new Map();
    /**
     * group label repeats
     */
    this.repostRows.forEach((row) => {
      if (mapRows.has(row.label)) {
        Object.keys(row).forEach(key => {
          if (['', '*'].includes(row[key])) {
            delete row[key];
          }
        });

        mapRows.set(row.label, {...mapRows.get(row.label), ...row});
      } else {
        mapRows.set(row.label, row);
      }
    });

    const columnLangCode = this.cliConfig.languages.reduce((acc, code) => {
      acc[code] = {
        get: (row) => {
          if (row[code] === '*') {
            return chalk.green(row[code])
          }

          return chalk.red(row[code]);
        },
        header: code,
        minWidth: 7,
      }
      return acc;
    }, {})

    ux.table<Partial<ISyncRowReport>>([...mapRows.values()].map((v, k) => ({
      ...v, id: (k + 1).toString(),
    })), {
      id: {
        header: '#',
        minWidth: 7,
      },
      ...columnLangCode,
      label: {
        get: (row) => {
          return chalk.cyan(row.label);
        },
        header: 'Label',
        minWidth: 20,
      }
    }, {
      'no-truncate': true
    })
  }

  private async taskCreateTranslationEnum(ctx: CtxTasks) {
    const lc = Object.keys(ctx.mapLang)[0];

    await this.makeTranslationEnum(ctx.mapLang[lc])
  }

  private async taskLabelAreSynchronized(ctx: CtxTasks) {
    for (const currentLang in ctx.mapLang) {
      const restLanguages = [...this.cliConfig.languages];

      restLanguages.splice(restLanguages.indexOf(currentLang), 1);
      restLanguages.sort((a, b) => {
        return this.langCodePriority[a] - this.langCodePriority[b];
      });

      for (const sourceLang of restLanguages) {
        const added: Set<string> = await this.flattenAddMissingKeys(
          sourceLang,
          currentLang,
          ctx.mapLang[currentLang].translateFlatten,
          ctx.mapLang[sourceLang].translateFlatten
        );

        added.forEach((label) => {
          UTIL.setNestedValue(ctx.mapLang[currentLang].translate, label, ctx.mapLang[currentLang].translateFlatten[label])
        })
      }

      await Helper.writeOrCreateJsonFile(UTIL.sortObjByKey(ctx.mapLang[currentLang].translate), ctx.mapLang[currentLang].file);
    }
  }

  private async taskReadConfiguration() {
    await this.readCliConfig();

    this.translateEngine = new TranslateEngine({...this.cliConfig}, this.config.cacheDir);

    this.langCodePriority = this.createLangCodePriority([...this.cliConfig.languages]);
  }

  private async taskReadLanguageFiles(ctx: CtxTasks) {
    ctx.mapLang =  await this.getTranslationLanguages();
  }

  private async translateText(text: string | string[], sourceLangCode: string, targetLangCode: string) {
    if (this.autoTranslate && !Array.isArray(text)) {
      return this.translateEngine.translateText({
        from: sourceLangCode,
        text,
        to: targetLangCode
      });
    }

    return text;
  }
}

interface CtxTasks {
  mapLang: TTranslation;
}
