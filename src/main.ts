import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'

async function run(): Promise<void> {
  try {
    if (!process.env.GITHUB_REF) throw new Error('missing GITHUB_REF')
    if (!process.env.GITHUB_REPOSITORY)
      throw new Error('missing GITHUB_REPOSITORY')
    //comes from {{secrets.GITHUB_TOKEN}}
    const token = core.getInput('repo-token', {required: true})

    const octokit = new Octokit({auth: token})

    octokit.repos.listCollaborators()

    const [owner, repositoryName] = process.env.GITHUB_REPOSITORY.split('/')
    const collaborators = await octokit.repos.listCollaborators({
      owner,
      repo: repositoryName
    })

    core.debug(JSON.stringify(collaborators.data))
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
