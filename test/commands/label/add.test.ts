import {expect, test} from '@oclif/test'

describe('label:add', () => {
  test
  .stdout()
  .command(['label:add', 'hello.world', '-fen', '-t="Hello World!"'])
  .it('runs label:add hello.world', ctx => {
    expect(ctx.expectation).to.contain('label:add hello.world')
  })
})
