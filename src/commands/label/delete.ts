import {Args, Flags, ux} from '@oclif/core'
import chalk from "chalk";

import {ILabelDeleteRowReport} from "../../shared/entities/report.js";
import {Helper} from "../../shared/helper.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {UTIL} from "../../shared/util.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:delete hello.world
 */
export default class LabelDelete extends LabelBaseCommand<typeof LabelDelete> {
  static args = {
    label: Args.string({
      description: 'A label key',
      required: true
    }),
  }

  static description = 'Delete the specified label.'

  static examples = [
    `<%= config.bin %> <%= command.id %> hello`,
    `<%= config.bin %> <%= command.id %> hello.world`,
  ];

  static flags = {
    noReport: Flags.boolean({aliases: ['no-report'], char: 'r', default: false}),
  }

  private label: string;
  private noReport: boolean;

  private reportRows: ILabelDeleteRowReport[] = [];

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LabelDelete);

    await this.readCliConfig();
    this.label = args.label;
    this.noReport = flags.noReport;

    const mapLang =  await this.getTranslationLanguages();

    let code: string;
    for (code in mapLang) {
      let isChange = false;
      const reportRow: ILabelDeleteRowReport = {
        code,
        labels: [],
        status: ''
      };
      if (this.label in mapLang[code].translateFlatten) {
        mapLang[code].translate = UTIL.deletePropertyPath(mapLang[code].translate, this.label);
        isChange = true;

        reportRow.status = '*';
      } else {
        for (const labelKey in mapLang[code].translateFlatten) {
          if (isChange) {
            // eslint-disable-next-line max-depth
            if (labelKey.startsWith(`${this.label}.`)) {
              reportRow.labels.push(labelKey);
            }

            continue;
          }

          if (labelKey.startsWith(`${this.label}.`)) {
            mapLang[code].translate = UTIL.deletePropertyPath(mapLang[code].translate, this.label);
            isChange = true;

            reportRow.status = '-';

            reportRow.labels.push(labelKey);
          }
        }
      }

      if (isChange) {
        await Helper.writeOrCreateJsonFile(UTIL.sortObjByKey(mapLang[code].translate), mapLang[code].file);
      }

      this.reportRows.push(reportRow);
    }

    if (code) {
      await this.makeTranslationEnum({
        ...mapLang[code],
        translateFlatten: UTIL.flattenObject(mapLang[code].translate)
      });
    }

    this.showReport();

    this.log(chalk.cyan(`Done!`));
  }

  private showReport() {
    if (this.noReport) {
      return;
    }

    ux.table<Partial<ILabelDeleteRowReport>>(this.reportRows, {
      code: {
        get: (row) => {
          return chalk.green(row.code);
        },
        header: 'Lang',
        minWidth: 7,
      },
      status: {
        get: (row) => {
          return chalk.cyan(row.status);
        },
        header: 'Deleted',
        minWidth: 7,
      },
      // eslint-disable-next-line
      labels: {
        get: (row) => {
          return chalk.yellow(row.labels.join(', '));
        },
        header: 'Labels',
        minWidth: 10
      }
    }, {
      'no-truncate': true
    })
  }
}
