import {Args, Flags} from '@oclif/core'
import {printTable} from '@oclif/table'
import chalk from "chalk";

import {LabelBaseCommand} from "../../shared/label-base.command.js";

/**
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:get
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:get hello.world
 * node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev label:get hello.world -f="en"
 */
export default class LabelGet extends LabelBaseCommand<typeof LabelGet> {
  static args = {
    label: Args.string({default: null,  description: 'A label key', requiredOrDefaulted: true}),
  }

  static description = 'Display a list of translations for the specified label'

  static enableJsonFlag = true;

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> hello.world',
    '<%= config.bin %> <%= command.id %> hello.world -f="en"',
    '<%= config.bin %> <%= command.id %> hello.world -fen',
  ]

  static flags = {
    fromLangCode: Flags.string({char: 'f', description: 'The language code of source text.'}),
  }

  public async run(): Promise<NonNullable<object> | void> {
    const {args, flags} = await this.parse(LabelGet);

    await this.readCliConfig();

    const mapLangs =  await this.getTranslationLanguages();

    const rows = [];

    let code: string;
    if (flags.fromLangCode) {
      code = await this.getLangCode(this.cliConfig.languages, flags.fromLangCode, this.cliConfig.langCodeDefault);

      const data = this.findLabels(args.label, mapLangs[code].translateFlatten).map((row) => {
        return {code, ...row};
      });

      rows.push(...data)
    } else {
      for (code in mapLangs) {
        const data = this.findLabels(args.label, mapLangs[code].translateFlatten).map((row) => {
          return {code, ...row};
        });

        rows.push(...data)
      }
    }

    if (this.jsonEnabled()) {
      return rows
    }

    printTable({
      columns: [
        {key: 'id', name: '#', width: 7},
        {key: 'code', name: 'Code', width: 10},
        {key: 'label', name: 'Label', width: 20},
        {key: 'trans', name: 'Translate', width: 20},
      ],
      data: rows.map((row, index) => ({
        code: chalk.yellow(row.code),
        id: (index + 1).toString(),
        label: chalk.green(row.label),
        trans: chalk.cyan(String(row.trans)),
      })),
      maxWidth: 'none',
      overflow: 'wrap',
    })
  }

  private findLabels(label: string, translateFlatten:  Record<string, string | string[]>) {
    const rows = [];

    if (label in translateFlatten) {
      rows.push({
        label,
        trans: translateFlatten[label]
      });
    }

    let labelKey: string;
    for (labelKey in translateFlatten) {
      if (labelKey.startsWith(`${label}.`)) {
        rows.push({
          label: labelKey,
          trans: translateFlatten[labelKey]
        });
      }
    }

    return rows;
  }
}
