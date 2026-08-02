import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface IFileMutation {
  content?: Buffer | string
  delete?: boolean
  file: string
}

const writeFileAtomic = async (file: string, content: Buffer | string): Promise<void> => {
  const directory = path.dirname(file)
  const temporaryFile = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)

  await fs.promises.mkdir(directory, {recursive: true})

  try {
    await fs.promises.writeFile(temporaryFile, content, {flag: 'wx'})
    await fs.promises.rename(temporaryFile, file)
  } finally {
    await fs.promises.rm(temporaryFile, {force: true})
  }
}

export async function applyFileTransaction(mutations: IFileMutation[]): Promise<void> {
  const targets = mutations.map(({file}) => path.resolve(file))
  if (new Set(targets).size !== targets.length) {
    throw new Error('A file transaction cannot mutate the same path more than once.')
  }

  const snapshots = new Map<string, Buffer | null>()
  for (const file of targets) {
    const stat = fs.statSync(file, {throwIfNoEntry: false})
    if (stat && !stat.isFile()) throw new Error(`Transaction target is not a file: ${file}`)
    snapshots.set(file, stat ? await fs.promises.readFile(file) : null)
  }

  const applied: string[] = []
  try {
    for (const mutation of mutations) {
      const file = path.resolve(mutation.file)
      if (mutation.delete) await fs.promises.rm(file, {force: true})
      else if (mutation.content === undefined) throw new Error(`Missing content for ${file}.`)
      else await writeFileAtomic(file, mutation.content)
      applied.push(file)
    }
  } catch (error) {
    for (const file of applied.reverse()) {
      const snapshot = snapshots.get(file)
      if (snapshot === null) await fs.promises.rm(file, {force: true})
      else if (snapshot) await writeFileAtomic(file, snapshot)
    }

    throw error
  }
}

export {writeFileAtomic}
