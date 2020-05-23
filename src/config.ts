import * as core from '@actions/core'
import yaml from 'js-yaml'
import fs from 'fs'

export interface Config {
  [group: string]: {
    usernames: string[]
    reviewers: number
  }
}

export const getConfig = (): Config => {
  const configPath = core.getInput('config', {required: true})

  try {
    return yaml.safeLoad(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    core.setFailed(error.message)
  }

  return {}
}
