import {expect, test} from '@oclif/test'

describe('export:csv', () => {
  test
  .stdout()
  .command(['export:csv'])
  .it('runs export:csv', ctx => {
    expect(ctx.expectation).to.contain('export:csv')
  })
})
