import {Octokit} from '@octokit/rest'
import nock from 'nock'
import {runLottery, Pull} from '../src/lottery'

const octokit = new Octokit()
const prNumber = 123
const ref = 'refs/pull/branch-name'
const basePull = {number: prNumber, head: {ref}}

function hasDuplicates(array: string[]): boolean {
  return new Set(array).size !== array.length
}

const mockGetPull = (pull: Pull) =>
  nock('https://api.github.com')
    .get('/repos/uesteibar/repository/pulls')
    .reply(200, [pull])

test('selects reviewers from a pool of users, ignoring author', async () => {
  const pull = {
    ...basePull,
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidates = ['A', 'B', 'C', 'D', 'author']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
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
    ref
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})

test('selects reviewers from a pool of users, ignoring author and the selected reviewers from another group', async () => {
  const pull = {
    ...basePull,
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidatesTeamA = ['A', 'B', 'author']
  const candidatesTeamB = ['C', 'D', 'author']
  const allCandidates = ['A', 'B', 'C', 'D', 'author']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        body.reviewers.forEach((reviewer: string) => {
          expect(allCandidates).toContain(reviewer)
          expect(reviewer).not.toEqual('author')
        })
        expect(body.reviewers.length).toEqual(4)
        expect(hasDuplicates(body.reviewers)).toBe(false)
        return true
      }
    )
    .reply(200, pull)

  const config = {
    groups: [
      {
        name: 'Test-A',
        reviewers: 2,
        usernames: candidatesTeamA
      },
      {
        name: 'Test-B',
        reviewers: 2,
        usernames: candidatesTeamB
      }
    ]
  }

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
    ref
  })

  getPullMock.done()
  nock.cleanAll()
})

test("doesn't send invalid reviewers if there is no elegible reviewers from one group", async () => {
  const pull = {
    ...basePull,
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
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toEqual(['A'])

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

test('selects internal reviewers if configured and author belongs to group', async () => {
  const pull = {
    ...basePull,
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidates = ['A', 'B', 'C', 'D', 'author']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toHaveLength(1)

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
        internal_reviewers: 1,
        usernames: candidates
      }
    ]
  }

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})

test("doesn't assign internal reviewers if the author doesn't belong to group", async () => {
  const pull = {
    ...basePull,
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidates = ['A', 'B', 'C', 'D']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/uesteibar/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toHaveLength(2)

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
        internal_reviewers: 1,
        usernames: candidates
      }
    ]
  }

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})

test("doesn't assign reviewers if the author doesn't belong to group", async () => {
  const pull = {
    ...basePull,
    user: {login: 'author'},
    draft: false
  }

  const getPullMock = mockGetPull(pull)

  const candidates = ['A', 'B', 'C', 'D']

  const config = {
    groups: [
      {
        name: 'Test',
        internal_reviewers: 1,
        usernames: candidates
      }
    ]
  }

  await runLottery(octokit, config, {
    repository: 'uesteibar/repository',
    ref
  })

  getPullMock.done()

  nock.cleanAll()
})
