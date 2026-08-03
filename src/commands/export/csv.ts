import {Parser} from '@json2csv/plainjs'
import {Args, Flags} from '@oclif/core'
import path from 'node:path'

import {writeFileAtomic} from '../../shared/atomic-file.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {LabelMutationRepository} from '../../shared/label-mutation.repository.js'
import {ELineSeparator, LINE_SEPARATOR_LOWER} from '../../shared/line-separator.js'

export default class ExportCsv extends LabelBaseCommand<typeof ExportCsv> {
  static args = {
    langCode: Args.string({description: 'The language code. If not specified, all available translations are exported.', required: false}),
  }

  static description = 'Export translations to a deterministic CSV file'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> en',
    '<%= config.bin %> <%= command.id %> en --include=uk',
    '<%= config.bin %> <%= command.id %> en --outputFile=dist/output.csv',
    '<%= config.bin %> <%= command.id %> --delimiter=,',
    '<%= config.bin %> <%= command.id %> --eol=lf',
  ]

  static flags = {
    delimiter: Flags.string({char: 'd', default: ',', description: 'delimiter of columns'}),
    eol: Flags.string({default: 'lf', options: LINE_SEPARATOR_LOWER}),
    include: Flags.string({char: 'i', description: 'include one additional language code'}),
    outputFile: Flags.string({char: 'o', default: 'dist/output.csv', description: 'path to save the file'}),
    withBOM: Flags.boolean({description: 'write a UTF-8 BOM character'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ExportCsv)

    try {
      if (flags.delimiter.length !== 1 || flags.delimiter === '"' || /[\r\n]/.test(flags.delimiter)) {
        throw new Error('CSV delimiter must be one character other than a quote or line break.')
      }

      await this.readCliConfig()
      const requested = [args.langCode, flags.include].filter((value): value is string => value !== undefined)
      for (const language of requested) {
        if (!this.cliConfig.languages.includes(language)) throw new Error('Language "' + language + '" is not configured.')
      }

      const selectedSet = new Set(requested)
      const selected = requested.length === 0
        ? this.cliConfig.languages
        : this.cliConfig.languages.filter(language => selectedSet.has(language))
      const snapshot = await LabelMutationRepository.load(this.cliConfig, {languages: selected})
      const labels = [...new Set(snapshot.dictionaries.flatMap(dictionary => [...dictionary.flat.keys()]))].sort()
      const rows = labels.map(label => {
        const row: Record<string, string> = {label}
        for (const dictionary of snapshot.dictionaries) {
          row[dictionary.code] = dictionary.flat.get(label) ?? ''
          row[dictionary.code + '_new'] = ''
        }

        return row
      })
      const fields = [
        {label: 'label', value: 'label'},
        ...snapshot.dictionaries.flatMap(dictionary => [
          {label: dictionary.code, value: dictionary.code},
          {label: dictionary.code + '_new', value: dictionary.code + '_new'},
        ]),
      ]
      const parser = new Parser({
        delimiter: flags.delimiter,
        eol: ELineSeparator[flags.eol.toUpperCase()],
        fields,
        withBOM: flags.withBOM,
      })
      const outputFile = path.resolve(flags.outputFile)
      await writeFileAtomic(outputFile, parser.parse(rows))
      this.log('File saved: ' + outputFile)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
