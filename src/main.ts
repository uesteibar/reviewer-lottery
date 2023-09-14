import * as core from '@actions/core'
import {runLottery} from './lottery'
import {Octokit} from '@octokit/rest'
import {getConfig} from './config'

async function run(): Promise<void> {
  try {
    if (!process.env.GITHUB_REF) throw new Error('missing GITHUB_REF')
    if (!process.env.GITHUB_REPOSITORY)
      throw new Error('missing GITHUB_REPOSITORY')
    //comes from {{secrets.GITHUB_TOKEN}}
    const token = core.getInput('repo-token', {required: true})
    const userBaseUrl = core.getInput('base-url', {required: false})
    const config = getConfig()
  

    await runLottery(new Octokit({auth: token, baseUrl: userBaseUrl}), config)
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
