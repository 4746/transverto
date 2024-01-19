import {expect, test} from '@oclif/test'

describe('label:get', () => {
  test
  .stdout()
  .command(['label:get', 'hello.world'])
  .it('runs label:get hello.world', ctx => {
    expect(ctx.expectation).to.contain('label:get hello.world')
  })
})
