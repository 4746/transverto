import { Parser } from '@json2csv/plainjs';
import {Args, Flags} from '@oclif/core'
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";

import {ITranslation} from "../../shared/entities/translate.js";
import {LabelBaseCommand} from "../../shared/label-base.command.js";
import {ELineSeparator, LINE_SEPARATOR_LOWER} from "../../shared/line-separator.js";
import {UTIL} from "../../shared/util.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev export:csv
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev export:csv en --include=uk
 */
export default class ExportCsv extends LabelBaseCommand<typeof ExportCsv> {
  static args = {
    langCode: Args.string({description: 'The language code. If not specified, all available translations are exported.', required: false}),
  }

  static description = 'Export translations to file.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> en',
    '<%= config.bin %> <%= command.id %> en --include=uk',
    '<%= config.bin %> <%= command.id %> en --outputFile=dist/output.csv',
    '<%= config.bin %> <%= command.id %> --delimiter=,',
    '<%= config.bin %> <%= command.id %> --eol=lf',
  ]

  static flags = {
    delimiter: Flags.string({char: 'd', default: ',', description: 'delimiter of columns.'}),
    eol: Flags.string({
      default: 'lf',
      multiple: false,
      options: LINE_SEPARATOR_LOWER,
      requiredOrDefaulted: true,
    }),
    include: Flags.string({char: 'i', default: null, description: 'include language code', multiple: false, requiredOrDefaulted: true}),
    outputFile: Flags.string({char: 'o', default: 'dist/output.csv', description: 'Path to save the file'}),
    withBOM: Flags.boolean({description: '[default: false] with BOM character'}),
  }

  private csvFields = [
    {
      label: 'label',
      value: 'label'
    },
  ];

  private data: Record<string, Record<string, string>> = {};

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ExportCsv)

    await this.readCliConfig();

    let langCode: string;
    let includeLangCode: string;

    if (args.langCode) {
      langCode = await this.getLangCode(this.cliConfig.languages, args.langCode);

      if (flags.include && this.cliConfig.languages.includes(flags.include)) {
        includeLangCode = flags.include;
      }
    }

    const mapTranslation =  await this.getTranslationLanguages();

    if (args.langCode) {
      this.langRows(mapTranslation[langCode]);

      if (includeLangCode && includeLangCode !== langCode) {
        this.langRows(mapTranslation[includeLangCode]);
      }
    } else {
      for (langCode in mapTranslation) {
        this.langRows(mapTranslation[langCode]);
      }
    }

    const parser = new Parser({
      delimiter : flags.delimiter,
      eol: flags.eol ? ELineSeparator[flags.eol?.toUpperCase()] : ELineSeparator.LF,
      fields: this.csvFields,
      quote: `"`,
      withBOM: flags.withBOM
    });

    const csv = parser.parse(Object.values(this.data));

    await fs.promises.writeFile(path.resolve(flags.outputFile), csv, {encoding: 'utf8', flag: 'w'});

    this.log(chalk.green(`File saved: ${path.resolve(flags.outputFile)}`));
    this.log(chalk.cyan(`Done!`));
  }

  private langRows(mapLang: ITranslation) {
    let label: string;
    let value: string | string[];

    for (label in mapLang.translateFlatten) {
      value = mapLang.translateFlatten[label];

      if (Array.isArray(value)) {
        value = value.join('🏁');
      } else if (!UTIL.isString(value)) {
        value = '';
      }

      if (label in this.data) {
        this.data[label][mapLang.code] = value;
        this.data[label][`${mapLang.code}_new`] = '';
      } else {
        this.data[label] = {
          [`${mapLang.code}_new`]: '',
          label,
          [mapLang.code]: value
        }
      }
    }

    this.csvFields.push(
      {
        label: mapLang.code,
        value: mapLang.code,
      },
      {
        label: `${mapLang.code}_new`,
        value: `${mapLang.code}_new`,
      }
    );
  }
}
