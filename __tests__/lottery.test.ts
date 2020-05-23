import {Octokit} from '@octokit/rest'
import nock from 'nock'
import {runLottery} from '../src/lottery'

test('selects reviewers from a pool of users, ignoring author', async () => {
  const octokit = new Octokit()

  const pull = {
    user: {login: 'author'}
  }

  const candidates = ['A', 'B', 'C', 'D', 'author']

  const getPullMock = nock('https://api.github.com:443')
    .get('/repos/uesteibar/repository/pulls/123')
    .reply(200, pull)

  const postReviewersMock = nock('https://api.github.com:443')
    .post(
      '/repos/uesteibar/repository/pulls/123/requested_reviewers',
      (body): boolean => {
        body.reviewers.forEach((reviewer: string) => {
          expect(candidates).toContain(reviewer)
          expect(reviewer).not.toEqual('author')
        })
        return true
      }
    )
    .reply(200, pull)

  const config = {
    groups: [
      {
        name: 'Test',
        reviewers: 2,
        usernames: candidates
      }
    ]
  }

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref: 'refs/pull/123'
  })

  getPullMock.done()
  postReviewersMock.done()
})
