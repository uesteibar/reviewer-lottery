import {Octokit} from '@octokit/rest'
import nock from 'nock'
import {runLottery, Pull} from '../src/lottery'

const octokit = new Octokit()
const prNumber = 123
const ref = 'refs/pull/branch-name'
const basePull = {number: prNumber, head: {ref}}

const config = {
  total_reviewers: 2,
  in_group_reviewers: 1,
  codeowners: ['B', 'C'],
  groups: {
    GroupA: ['A', 'B'],
    GroupB: ['C', 'D'],
    GroupC: ['E', 'F']
  }
}

const mockGetPull = (pull: Pull) =>
  nock('https://api.github.com')
    .get('/repos/uesteibar/repository/pulls')
    .reply(200, [pull])

test('selects in-group reviewers first, then out-group reviewers', async () => {
  const pull = {
    ...basePull,
    user: {login: 'B'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const outGroupCandidates = ['C', 'D', 'E', 'F']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers[0]).toEqual('A')
        expect(outGroupCandidates).toContain(body.reviewers[1])

        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})

test("doesn't assign reviewers if the PR is in draft state", async () => {
  const pull = {
    ...basePull,
    user: {login: 'author'},
    draft: true
  }

  const getPullMock = mockGetPull(pull)

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  getPullMock.done()
  nock.cleanAll()
})

test("doesn't assign in-group reviewers if the only option is a CO", async () => {
  const pull = {
    ...basePull,
    user: {login: 'A'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const outGroupCandidates = ['C', 'D', 'E', 'F']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toHaveLength(2)
        body.reviewers.forEach((reviewer: string) => {
          expect(outGroupCandidates).toContain(reviewer)
        })

        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  postReviewersMock.done()
  getPullMock.done()
  nock.cleanAll()
})

test("assign any reviewers if the author doesn't belong to any group", async () => {
  const pull = {
    ...basePull,
    user: {login: 'G'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidates = ['A', 'B', 'C', 'D', 'E', 'F']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toHaveLength(2)

        body.reviewers.forEach((reviewer: string) => {
          expect(candidates).toContain(reviewer)
        })
        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})
