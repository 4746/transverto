import {Flags} from '@oclif/core'
import path from 'node:path'

import {CTV_TRANSLATION_CACHE_FILE} from '../../shared/constants.js'
import {LabelBaseCommand} from '../../shared/label-base.command.js'
import {TranslationCacheService} from '../../shared/translation-cache.service.js'

export default class CachePrune extends LabelBaseCommand<typeof CachePrune> {
  static description = 'Prune expired and least-recently-used cache entries'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    json: Flags.boolean({description: 'output stable JSON'}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(CachePrune)

    try {
      const config = await this.readCliConfig()
      const file = path.join(this.config.cacheDir, CTV_TRANSLATION_CACHE_FILE)
      const result = await new TranslationCacheService(file, config.cache).prune()
      const output = {...result, file}
      if (flags.json) this.log(JSON.stringify(output, null, 2))
      else {
        this.log(`Removed: ${result.removed} (${result.expired} expired, ${result.removedByLimit} LRU)`)
        this.log(`Remaining: ${result.remaining}`)
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }
  }
}
