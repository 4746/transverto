import {Flags} from '@oclif/core'
import path from 'node:path'

import {CTV_TRANSLATION_CACHE_FILE} from '../../shared/constants.js'
import {ITranslationCacheFilters} from '../../shared/entities/translation-cache.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {TranslationCacheService} from '../../shared/translation-cache.service.js'

export default class CacheList extends LabelBaseCommand<typeof CacheList> {
  static description = 'List cached AI translations and cache statistics'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --engine lmstudio --from en --to uk',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    engine: Flags.string({description: 'filter by engine profile name'}),
    from: Flags.string({description: 'filter by source language'}),
    json: Flags.boolean({description: 'output stable JSON'}),
    model: Flags.string({description: 'filter by exact model name'}),
    to: Flags.string({description: 'filter by target language'}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(CacheList)

    try {
      const config = await this.readCliConfig()
      const filters: ITranslationCacheFilters = {
        ...(flags.engine ? {profile: flags.engine} : {}),
        ...(flags.from ? {from: flags.from} : {}),
        ...(flags.model ? {model: flags.model} : {}),
        ...(flags.to ? {to: flags.to} : {}),
      }
      const file = path.join(this.config.cacheDir, CTV_TRANSLATION_CACHE_FILE)
      const result = await new TranslationCacheService(file, config.cache).list(filters)

      if (flags.json) {
        this.log(JSON.stringify({...result, file}, null, 2))
        return
      }

      this.log(`Cache: ${file}`)
      this.log(`Entries: ${result.summary.count}`)
      this.log(`Oldest: ${result.summary.oldestCreatedAt ?? '-'}`)
      if (result.summary.profiles.length > 0) {
        this.log('PROFILE  MODEL  ENTRIES')
        for (const item of result.summary.profiles) {
          this.log(`${item.profile}  ${item.model}  ${item.count}`)
        }
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
