import {expect, test} from '@oclif/test'

const inputText = 'Text';

describe('translate:google', () => {
  test
    .stdout()
    .command([`translate:google`, inputText, '--to=en'])
    .it(`runs translate:google ${inputText} --to=en`, ctx => {
      expect(ctx.stdout).to.contain(inputText)
    })
})
