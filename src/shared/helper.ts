import {readJson, writeJson} from "fs-extra/esm";
import fs from "node:fs";
import path from "node:path";

import {UTIL} from "./util.js";

const readJsonFile = async (pathFile: string): Promise<NonNullable<object>> => {
  const data = await readJson(pathFile, {encoding: 'utf8'});

  return UTIL.isObject(data) ? data : {};
}

const writeJsonFile = async (dataJson: NonNullable<object>, pathFile: string, spaces = 2) => {
  return  writeJson(pathFile, dataJson, {
    encoding: 'utf8',
    spaces
  });
}

const writeOrCreateJsonFile = async (dataJson: NonNullable<object>, pathFile: string) => {
  const stat = fs.statSync(pathFile, {throwIfNoEntry: false});

  if (!stat) {
    await fs.promises.mkdir(path.dirname(pathFile), {recursive: true});

    return writeJsonFile(dataJson, pathFile);
  } else if (stat.isFile()) {
    return writeJsonFile(dataJson, pathFile);
  }

  throw new Error(`Path [${pathFile}] already exists and is not a file.`);
}

const getPathLanguageFile = (lang: string, basePath: string) => {
  return path.join(process.cwd(), basePath, `${lang}.json`);
}

export const Helper = {
  getPathLanguageFile,
  readJsonFile,
  writeJsonFile,
  writeOrCreateJsonFile,
}
