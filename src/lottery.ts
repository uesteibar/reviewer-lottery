import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'

interface User {
  login: string
}

const getOwnerAndRepo = (): {owner: string; repo: string} => {
  if (!process.env.GITHUB_REPOSITORY)
    throw new Error('missing GITHUB_REPOSITORY')

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

  return {owner, repo}
}

const getPRNumber = (): number => {
  if (!process.env.GITHUB_REF) throw new Error('missing GITHUB_REF')

  return Number(process.env.GITHUB_REF.split('refs/pull/')[1].split('/')[0])
}

const getPRAuthor = async (octokit: Octokit): Promise<string> => {
  try {
    const {data} = await octokit.pulls.get({
      ...getOwnerAndRepo(),
      pull_number: getPRNumber() // eslint-disable-line @typescript-eslint/camelcase
    })

    return data.user.login || ''
  } catch (error) {
    core.info(error.message())
    core.setFailed(error.message())
  }

  return ''
}

const selectReviewers = async (
  octokit: Octokit,
  users: User[],
  n: number
): Promise<string[]> => {
  const reviewers: string[] = []
  const author = await getPRAuthor(octokit)
  const userLogins = users
    .map(({login}) => login)
    .filter(login => login !== author)
  for (let i = 0; i < n; i++) {
    const random = Math.floor(Math.random() * userLogins.length)
    const reviewer = userLogins.splice(random, 1)[0]
    reviewers.push(reviewer)
  }

  return reviewers
}

const setReviewers = async (
  octokit: Octokit,
  users: User[]
): Promise<object> => {
  const reviewers = await selectReviewers(octokit, users, 1)

  return octokit.pulls.createReviewRequest({
    ...getOwnerAndRepo(),
    pull_number: getPRNumber(), // eslint-disable-line @typescript-eslint/camelcase
    reviewers
  })
}

export const runLottery = async (octokit: Octokit): Promise<void> => {
  try {
    const {data} = await octokit.repos.listCollaborators(getOwnerAndRepo())

    await setReviewers(octokit, data)
  } catch (error) {
    core.info(error.message())
    core.setFailed(error.message())
  }
}
