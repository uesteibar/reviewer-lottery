import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'

interface Env {
  repository: string
  ref: string
}

class Lottery {
  octokit: Octokit
  config: Config
  env: Env

  constructor({
    octokit,
    config,
    env
  }: {
    octokit: Octokit
    config: Config
    env: Env
  }) {
    this.octokit = octokit
    this.config = config
    this.env = {
      repository: env.repository,
      ref: env.ref
    }
  }

  async run(): Promise<void> {
    try {
      const reviewers = await this.selectReviewers()
      await this.setReviewers(reviewers)
    } catch (error) {
      core.info(error)
      core.setFailed(error)
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
      for (const {reviewers, usernames} of this.config.groups) {
        selected = selected.concat(
          this.pickRandom(usernames, reviewers, author)
        )
      }
    } catch (error) {
      core.setFailed(error)
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
      core.info(error)
      core.setFailed(error)
    }

    return ''
  }

  getOwnerAndRepo(): {owner: string; repo: string} {
    const [owner, repo] = this.env.repository.split('/')

    return {owner, repo}
  }

  getPRNumber(): number {
    return Number(this.env.ref.split('refs/pull/')[1].split('/')[0])
  }
}

export const runLottery = async (
  octokit: Octokit,
  config: Config,
  env = {
    repository: process.env.GITHUB_REPOSITORY || '',
    ref: process.env.GITHUB_REF || ''
  }
): Promise<void> => {
  const lottery = new Lottery({octokit, config, env})

  await lottery.run()
}
