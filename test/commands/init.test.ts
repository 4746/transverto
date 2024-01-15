import {expect, test} from '@oclif/test'
import {readJson, remove} from "fs-extra/esm";
import path from "node:path";

import {CTV_CONFIG_FILE_NAME} from "../../src/shared/constants.js";

describe('init', () => {
  const configFile =  path.resolve(CTV_CONFIG_FILE_NAME);

  test
  .stdout()
    .do(async () => {
      await remove(configFile)
    })
  .command(['init'])
  .it('runs init', async (ctx) => {

    expect(ctx.stdout).to.contain('Successfully')

    const data = await readJson(configFile)

    expect(data).to.have.property('basePath')
      .to.equal('dist/i18n');

    expect(data).to.have.property('basePathEnum')
      .to.equal('dist/i18n/language.ts');

    expect(data).to.have.property('engine')
      .to.equal('bing');

    expect(data).to.have.property('nameEnum')
      .to.equal('LanguageLabel');

    expect(data).to.have.property('languages')
      .to.be.an('array')
      .that.includes("en");

    expect(data).to.have.property('bing');
  })

  test
  .stdout()
    .do(async () => {
      await remove(configFile)
    })
  .command(['init', '--force'])
  .it('runs init --force', async (ctx) => {

    expect(ctx.stdout).to.contain('Successfully')
  })
})
