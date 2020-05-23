import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'

class Lottery {
  octokit: Octokit
  config: Config

  constructor({octokit, config}: {octokit: Octokit; config: Config}) {
    this.octokit = octokit
    this.config = config
  }

  async run(): Promise<void> {
    try {
      const reviewers = await this.selectReviewers()
      await this.setReviewers(reviewers)
    } catch (error) {
      core.info(error.message())
      core.setFailed(error.message())
    }
  }

  async setReviewers(reviewers: string[]): Promise<object> {
    return this.octokit.pulls.createReviewRequest({
      ...this.getOwnerAndRepo(),
      pull_number: this.getPRNumber(), // eslint-disable-line @typescript-eslint/camelcase
      reviewers
    })
  }

  async selectReviewers(): Promise<string[]> {
    let selected: string[] = []
    const author = await this.getPRAuthor()

    try {
      for (const {reviewers, usernames} of Object.values(this.config)) {
        selected = selected.concat(
          this.pickRandom(usernames, reviewers, author)
        )
      }
    } catch (error) {
      core.setFailed(error.message())
    }

    return selected
  }

  pickRandom(items: string[], n: number, ignore: string): string[] {
    const picks: string[] = []

    const candidates = items.filter(item => item !== ignore)

    while (picks.length < n) {
      const random = Math.floor(Math.random() * candidates.length)
      const pick = candidates.splice(random, 1)[0]

      if (!picks.includes(pick)) picks.push(pick)
    }

    return picks
  }

  async getPRAuthor(): Promise<string> {
    try {
      const {data} = await this.octokit.pulls.get({
        ...this.getOwnerAndRepo(),
        pull_number: this.getPRNumber() // eslint-disable-line @typescript-eslint/camelcase
      })

      return data.user.login || ''
    } catch (error) {
      core.info(error.message())
      core.setFailed(error.message())
    }

    return ''
  }

  getOwnerAndRepo(): {owner: string; repo: string} {
    if (!process.env.GITHUB_REPOSITORY)
      throw new Error('missing GITHUB_REPOSITORY')

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

    return {owner, repo}
  }

  getPRNumber(): number {
    if (!process.env.GITHUB_REF) throw new Error('missing GITHUB_REF')

    return Number(process.env.GITHUB_REF.split('refs/pull/')[1].split('/')[0])
  }
}

export const runLottery = async (
  octokit: Octokit,
  config: Config
): Promise<void> => {
  const lottery = new Lottery({octokit, config})

  await lottery.run()
}
