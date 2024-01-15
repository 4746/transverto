import {expect, test} from '@oclif/test'

describe('cache', () => {
  test
  .stdout()
  .command(['cache'])
  .it('runs cache', ctx => {
    expect(ctx.expectation).to.contain('cache')
  })
})
