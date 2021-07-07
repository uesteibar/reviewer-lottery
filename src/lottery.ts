import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'

export interface Pull {
  user: {
    login: string
  }
  draft: boolean
}
interface Env {
  repository: string
  ref: string
}

class Lottery {
  octokit: Octokit
  config: Config
  env: Env
  pr: Pull | null

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
    this.pr = null
  }

  async run(): Promise<void> {
    try {
      const ready = await this.isReadyToReview()
      if (ready) {
        const reviewers = await this.selectReviewers()
        reviewers.length > 0 && (await this.setReviewers(reviewers))
      }
    } catch (error) {
      core.error(error)
      core.setFailed(error)
    }
  }

  async isReadyToReview(): Promise<boolean> {
    try {
      const pr = await this.getPR()
      return !!pr && !pr.draft
    } catch (error) {
      core.error(error)
      core.setFailed(error)
      return false
    }
  }

  async setReviewers(reviewers: string[]): Promise<object> {
    const ownerAndRepo = this.getOwnerAndRepo()
    const pr = this.getPRNumber()

    return this.octokit.pulls.requestReviewers({
      ...ownerAndRepo,
      pull_number: pr, // eslint-disable-line @typescript-eslint/camelcase
      reviewers: reviewers.filter((r: string | undefined) => !!r)
    })
  }

  async selectReviewers(): Promise<string[]> {
    let selected: string[] = []
    const author = await this.getPRAuthor()

    try {
      for (const {
        reviewers,
        internal_reviewers: internalReviewers,
        usernames
      } of this.config.groups) {
        core.info(`internalReviewers: ${internalReviewers}`)
        const reviewersToRequest =
          usernames.includes(author) && internalReviewers
            ? internalReviewers
            : reviewers
        core.info(`reviewersToRequest: ${reviewersToRequest}`)

        if (reviewersToRequest) {
          selected = selected.concat(
            this.pickRandom(usernames, reviewersToRequest, author)
          )
        }
      }
    } catch (error) {
      core.error(error)
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
      const pr = await this.getPR()

      return pr ? pr.user.login : ''
    } catch (error) {
      core.error(error)
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

  async getPR(): Promise<Pull | null> {
    if (this.pr) return this.pr

    try {
      const {data} = await this.octokit.pulls.get({
        ...this.getOwnerAndRepo(),
        pull_number: this.getPRNumber() // eslint-disable-line @typescript-eslint/camelcase
      })

      this.pr = data

      return this.pr
    } catch (error) {
      core.error(error)
      core.setFailed(error)

      return null
    }
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
