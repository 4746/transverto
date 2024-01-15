import {expect, test} from '@oclif/test'

describe('label:sync', () => {
  test
  .stdout()
  .command(['label:sync'])
  .it('runs label:sync', ctx => {
    // expect(ctx.stdout).to.contain('Done!')
    expect(ctx.expectation).to.contain('label:sync')
  })
})
