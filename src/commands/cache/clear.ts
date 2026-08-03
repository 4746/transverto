import {confirm} from '@inquirer/prompts'
import {Flags} from '@oclif/core'
import path from 'node:path'

import {CTV_TRANSLATION_CACHE_FILE} from '../../shared/constants.js'
import {ITranslationCacheFilters} from '../../shared/entities/translation-cache.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {TranslationCacheService} from '../../shared/translation-cache.service.js'

export default class CacheClear extends LabelBaseCommand<typeof CacheClear> {
  static description = 'Remove cached AI translations'

  static examples = [
    '<%= config.bin %> <%= command.id %> --engine lmstudio --force',
    '<%= config.bin %> <%= command.id %> --from en --to uk --force --json',
    '<%= config.bin %> <%= command.id %> --force',
  ]

  static flags = {
    engine: Flags.string({description: 'clear only an engine profile'}),
    force: Flags.boolean({char: 'f', description: 'skip confirmation'}),
    from: Flags.string({description: 'clear only a source language'}),
    json: Flags.boolean({description: 'output stable JSON'}),
    model: Flags.string({description: 'clear only an exact model name'}),
    to: Flags.string({description: 'clear only a target language'}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(CacheClear)

    try {
      const config = await this.readCliConfig()
      const filters: ITranslationCacheFilters = {
        ...(flags.engine ? {profile: flags.engine} : {}),
        ...(flags.from ? {from: flags.from} : {}),
        ...(flags.model ? {model: flags.model} : {}),
        ...(flags.to ? {to: flags.to} : {}),
      }
      const file = path.join(this.config.cacheDir, CTV_TRANSLATION_CACHE_FILE)
      const service = new TranslationCacheService(file, config.cache)
      const {summary: {count}} = await service.list(filters)

      if (count > 0 && !flags.force) {
        if (flags.json || !process.stdin.isTTY || !process.stdout.isTTY) {
          this.error('Non-interactive or JSON cache clearing requires --force.', {exit: 2})
        }

        const accepted = await confirm({
          default: false,
          message: `Remove ${count} matching cache ${count === 1 ? 'entry' : 'entries'}?`,
        })
        if (!accepted) {
          this.log('No cache entries removed.')
          return
        }
      }

      const removed = await service.clear(filters)
      const output = {file, filters, remaining: (await service.list()).summary.count, removed}
      if (flags.json) this.log(JSON.stringify(output, null, 2))
      else this.log(`Removed ${removed} cache ${removed === 1 ? 'entry' : 'entries'}.`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
