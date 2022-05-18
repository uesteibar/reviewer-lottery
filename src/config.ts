import * as core from '@actions/core'
import yaml from 'js-yaml'
import fs from 'fs'

interface Group {
  name: string
  usernames: string[]
}
export interface Config {
  reviewers: number
  internal_reviewers: number
  codeowners: string[]
  groups: Group[]
}

export const getConfig = (): Config => {
  const configPath = core.getInput('config', {required: true})

  try {
    const config = yaml.safeLoad(fs.readFileSync(configPath, 'utf8')) as Config

    return config
  } catch (error) {
    core.setFailed(error.message)
  }

  return {reviewers: 0, internal_reviewers: 0, codeowners:[], groups:[]}
}
