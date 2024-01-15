import {expect, test} from '@oclif/test'

describe('label:replace', () => {
  test
  .stdout()
  .command(['label:replace', 'hello.world', '-t="Hello world2!"', '-fen'])
  .it('runs label:replace hello.world', ctx => {
    expect(ctx.expectation).to.contain('label:replace hello.world')
  })
})
