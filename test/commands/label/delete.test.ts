import {expect, test} from '@oclif/test'

describe('label:delete', () => {
  test
  .stdout()
  .command(['label:delete', 'hello.world'])
  .it('runs label:delete', ctx => {
    expect(ctx.expectation).to.contain('label:delete hello.world')
  })
})
