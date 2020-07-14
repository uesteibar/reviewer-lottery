import * as core from '@actions/core'
import yaml from 'js-yaml'
import fs from 'fs'

interface Group {
  name: string
  reviewers: number
  usernames: string[]
}
export interface Config {
  groups: Group[]
}

export const getConfig = (): Config => {
  const configPath = core.getInput('config', {required: true})

  try {
    return yaml.safeLoad(fs.readFileSync(configPath, 'utf8')) as Config
  } catch (error) {
    core.setFailed(error.message)
  }

  return {groups: []}
}
