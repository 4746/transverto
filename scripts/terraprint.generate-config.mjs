import fs from "node:fs";
import path from "node:path";
import got from "got";
import * as cheerio from 'cheerio';
import chalk from "chalk";
import {DEFAULT_USER_AGENT} from "../src/shared/constants.js";

// eslint-disable-next-line unicorn/prefer-top-level-await
;(async () => {
  const languages = await got('https://translate.terraprint.co/languages', {
    headers: {
      'Accept-Language': 'en-US,en',
      'User-Agent': DEFAULT_USER_AGENT
    },
  }).json();

  if (!Array.isArray(languages)) {
    throw new Error('Load languages')
  }

  let langMap = {}
  languages.forEach(({code, name}) => {
    langMap[code] = name;
  });

  await fs.promises.writeFile(
    path.resolve('src/shared/lang.terra.ts'),
    [
      '/* eslint-disable */',
      `/**\n * DO NOT EDIT!\n * THIS IS AUTOMATICALLY GENERATED FILE\n */\n`,
      'export const TERRA_LANG_MAP = ' + JSON.stringify(langMap, null, 2),
      '\n',
      'export type TTerraLangCode = keyof typeof TERRA_LANG_MAP;',
      'export type TTerraLangCodeExtend = keyof typeof TERRA_LANG_MAP | \'auto\' | string;',
      'export type TTerraLangCodeName = typeof TERRA_LANG_MAP[TTerraLangCode];',
      ''
    ].join('\n'),
    {
      flag: 'w',
      charset: 'utf-8'
    }
  )

  console.log(chalk.green('✔️ Generated const TERRA_LANG_MAP'))
})()
