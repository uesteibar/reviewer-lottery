import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'

export interface Pull {
  user: {login: string} | null
  number: number
  draft?: boolean
  labels?: {name: string}[] | null
}
interface Env {
  repository: string
  ref: string
}

class Lottery {
  octokit: Octokit
  config: Config
  env: Env
  pr: Pull | undefined | null

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
    this.pr = undefined
  }

  async run(): Promise<void> {
    try {
      const ready = await this.isReadyToReview()
      if (ready) {
        const reviewers = await this.selectReviewers()
        reviewers.length > 0 && (await this.setReviewers(reviewers))
      }
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }
  }

  async isReadyToReview(): Promise<boolean> {
    try {
      const pr = await this.getPR()
      return !!pr && !pr.draft
    } catch (error: any) {
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
      pull_number: pr,
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
        usernames,
        matchLabel
      } of this.config.groups) {
        const labels = this.getPRLabels()
        const shouldRunForGroup = matchLabel === undefined || labels.length === 0 || labels.includes(matchLabel)
        if (shouldRunForGroup) {
          const reviewersToRequest =
            usernames.includes(author) && internalReviewers
              ? internalReviewers
              : reviewers

          if (reviewersToRequest) {
            selected = selected.concat(
              this.pickRandom(usernames, reviewersToRequest, selected.concat(author))
            )
          }
        }
      }
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }

    return selected
  }

  pickRandom(items: string[], n: number, ignore: string[]): string[] {
    const picks: string[] = []

    const candidates = items.filter(item => !ignore.includes(item));

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

      return pr && pr.user ? pr.user.login : ''
    } catch (error: any) {
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
    return Number(this.pr?.number)
  }

  getPRLabels(): string[] {
    const labels = this.pr?.labels?.map((label) => label.name)

    if (labels) {
      return labels
    } else {
      return []
    } 
  }

  async getPR(): Promise<Pull | undefined> {
    if (this.pr) return this.pr

    try {
      const {data} = await this.octokit.pulls.list({
        ...this.getOwnerAndRepo()
      })

      this.pr = data.find(({head: {ref}}) => ref === this.env.ref)

      if (!this.pr) {
        throw new Error(`PR matching ref not found: ${this.env.ref}`)
      }

      return this.pr
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)

      return undefined
    }
  }
}

export const runLottery = async (
  octokit: Octokit,
  config: Config,
  env = {
    repository: process.env.GITHUB_REPOSITORY || '',
    ref: process.env.GITHUB_HEAD_REF || ''
  }
): Promise<void> => {
  const lottery = new Lottery({octokit, config, env})

  await lottery.run()
}
