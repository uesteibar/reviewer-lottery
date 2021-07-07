import {Octokit} from '@octokit/rest'
import nock from 'nock'
import {runLottery, Pull} from '../src/lottery'

const octokit = new Octokit()

const mockGetPull = (pull: Pull) =>
  nock('https://api.github.com')
    .get('/repos/uesteibar/repository/pulls/123')
    .reply(200, pull)

test('selects reviewers from a pool of users, ignoring author', async () => {
  const pull = {
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidates = ['A', 'B', 'C', 'D', 'author']

  const postReviewersMock = nock('https://api.github.com')
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

  nock.cleanAll()
})

test("doesn't assign reviewers if the PR is in draft state", async () => {
  const pull = {
    user: {login: 'author'},
    draft: true
  }

  const getPullMock = mockGetPull(pull)

  const config = {
    groups: [
      {
        name: 'Test',
        reviewers: 2,
        usernames: ['A', 'B']
      }
    ]
  }

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref: 'refs/pull/123'
  })

  getPullMock.done()
  nock.cleanAll()
})

test("doesn't send invalid reviewers if there is no elegible reviewers from one group", async () => {
  const pull = {
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const config = {
    groups: [
      {
        name: 'Test',
        reviewers: 1,
        usernames: ['A']
      },
      {
        name: 'Other group',
        reviewers: 1,
        usernames: ['author']
      }
    ]
  }

  const postReviewersMock = nock('https://api.github.com')
    .post(
      '/repos/uesteibar/repository/pulls/123/requested_reviewers',
      (body): boolean => {
        expect(body.reviewers).toEqual(['A'])

        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref: 'refs/pull/123'
  })

  postReviewersMock.done()
  getPullMock.done()
  nock.cleanAll()
})
