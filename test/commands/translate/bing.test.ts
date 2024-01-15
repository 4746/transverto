import {expect, test} from '@oclif/test'

const inputText = 'Text';

describe('translate:bing', () => {
  test
  .stdout()
  .command([`translate:bing`, inputText, '--to=en'])
  .it(`runs translate:bing ${inputText} --to=en`, ctx => {
    expect(ctx.stdout).to.contain(inputText)
  })
})
