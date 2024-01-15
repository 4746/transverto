import fs from "node:fs";
import path from "node:path";
import got from "got";
import * as cheerio from 'cheerio';
import chalk from "chalk";
import {DEFAULT_USER_AGENT} from "../src/shared/constants.js";

// eslint-disable-next-line unicorn/prefer-top-level-await
;(async () => {
  const {body: eptBody} = await got('https://bing.com/translator?edgepdftranslator=1', {
    headers: {
      'Accept-Language': 'en-US,en',
      'User-Agent': DEFAULT_USER_AGENT
    }
  });
  let $ = cheerio.load(eptBody)
  const eptLangOptions = $('#t_tgtAllLang').children('option')
  const eptLangCodes = []
  for (let i = 0, len = eptLangOptions.length, option; i < len; i++) {
    option = $(eptLangOptions[i])
    eptLangCodes.push(option.attr('value'))
  }

  const parseRichTranslateParams = (body) => JSON.parse(
    body.match(/params_RichTranslate\s?=\s?([^;]+);/)[1].replace(/,]$/, ']')
  )

  const {body} = await got('https://bing.com/translator', {
    headers: {
      'Accept-Language': 'en-US,en',
      'User-Agent': DEFAULT_USER_AGENT
    }
  })

  // fetch config
  const richTranslateParams = parseRichTranslateParams(body)
  // EPT config
  const eptRichTranslateParams = parseRichTranslateParams(eptBody)

  const config = {
    websiteEndpoint: richTranslateParams[1],
    translateEndpoint: richTranslateParams[0],
    spellCheckEndpoint: richTranslateParams[33],
    // maxTextLen: richTranslateParams[5],
    // PENDING: hard-coding
    maxTextLen: 1000,
    // PENDING: hard-coding
    maxTextLenCN: 5000,
    maxCorrectableTextLen: richTranslateParams[30],
    maxEPTTextLen: eptRichTranslateParams[5],
    correctableLangs: richTranslateParams[31],
    eptLangs: eptLangCodes,
    userAgent: DEFAULT_USER_AGENT
  }

  const data = [
    '/* eslint-disable */',
    `/**\n * DO NOT EDIT!\n * THIS IS AUTOMATICALLY GENERATED FILE\n */\n`,
    `export class BaseEngineBing {`,
    `  protected readonly maxTextLen = 1000;`,
    `  protected readonly maxTextLenCN = 5000;`,
    `  protected readonly maxCorrectableTextLen = ${richTranslateParams[30]};`,
    `  protected readonly maxEPTTextLen = ${eptRichTranslateParams[5]};`,
    `  protected readonly userAgent = '${DEFAULT_USER_AGENT}';`,
    `  protected readonly websiteEndpoint = 'https://{s}bing.com${richTranslateParams[1]}';`,
    `  protected readonly translateEndpoint = 'https://{s}bing.com${richTranslateParams[0]}';`,
    `  protected readonly spellCheckEndpoint = 'https://{s}bing.com${richTranslateParams[33]}';`,
    `  protected readonly correctableLangCode = ${JSON.stringify(richTranslateParams[31].sort())};`,
    `  protected readonly eptLangCode = ${JSON.stringify(eptLangCodes.sort())};`,
    `}`,
    ''
  ]

  await fs.promises.writeFile(
    path.resolve('src/shared/engines/base-engine-bing.ts'),
    data.join('\n'),
    {
      flag: 'w',
      charset: 'utf-8'
    }
  )

  console.log(chalk.green('✔️ Generated class BaseEngineBing'))

  // fetch supported languages
  $ = cheerio.load(body)
  const langOptions = $('#t_tgtAllLang').children('option')
  const langMap = {}
  for (let i = 0, len = langOptions.length, option; i < len; i++) {
    option = $(langOptions[i])
    langMap[option.attr('value')] = option.text().trim()
  }

  await fs.promises.writeFile(
    path.resolve('src/shared/lang.bing.ts'),
    [
      '/* eslint-disable */',
      `/**\n * DO NOT EDIT!\n * THIS IS AUTOMATICALLY GENERATED FILE\n */\n`,
      'export const BING_LANG_MAP = ' + JSON.stringify(langMap, null, 2),
      '\n',
      'export type TBingLangCode = keyof typeof BING_LANG_MAP;',
      'export type TBingLangCodeExtend = keyof typeof BING_LANG_MAP | \'auto-detect\' | string;',
      'export type TBingLangCodeName = typeof BING_LANG_MAP[TBingLangCode];',
      ''
    ].join('\n'),
    {
      flag: 'w',
      charset: 'utf-8'
    }
  )

  console.log(chalk.green('✔️ Generated const BING_LANG_MAP'))
})()
