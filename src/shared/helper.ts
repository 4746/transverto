import {readJson} from 'fs-extra/esm'
import fs from 'node:fs'
import path from 'node:path'

import {UTIL} from './util.js'

const readJsonFile = async (pathFile: string): Promise<NonNullable<object>> => {
  const data = await readJson(pathFile, {encoding: 'utf8'})

  return UTIL.isObject(data) ? data : {}
}

const writeJsonFile = async (dataJson: NonNullable<object>, pathFile: string, spaces = 2) => {
  const directory = path.dirname(pathFile)
  const temporaryFile = path.join(directory, `.${path.basename(pathFile)}.${process.pid}.${Date.now()}.tmp`)

  await fs.promises.mkdir(directory, {recursive: true})

  try {
    await fs.promises.writeFile(temporaryFile, `${JSON.stringify(dataJson, null, spaces)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await fs.promises.rename(temporaryFile, pathFile)
  } finally {
    await fs.promises.rm(temporaryFile, {force: true})
  }
}

const writeOrCreateJsonFile = async (dataJson: NonNullable<object>, pathFile: string) => {
  const stat = fs.statSync(pathFile, {throwIfNoEntry: false})

  if (!stat) {
    await fs.promises.mkdir(path.dirname(pathFile), {recursive: true})

    return writeJsonFile(dataJson, pathFile)
  } else if (stat.isFile()) {
    return writeJsonFile(dataJson, pathFile)
  }

  throw new Error(`Path [${pathFile}] already exists and is not a file.`)
}

const getPathLanguageFile = (lang: string, basePath: string) => {
  return path.join(process.cwd(), basePath, `${lang}.json`)
}

export const Helper = {
  getPathLanguageFile,
  readJsonFile,
  writeJsonFile,
  writeOrCreateJsonFile,
}
