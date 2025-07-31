import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { ActionOutputsImpl, LoggerImpl } from "./actions-service";
import { getConfig } from "./config";
import { GitHubServiceImpl } from "./github-service";
import { Lottery } from "./lottery";

function extractPRInfoFromContext(): {
  prNumber: number;
  repository: string;
  ref: string;
  author?: string;
} {
  // Use GitHub context for PR information
  if (
    context.eventName !== "pull_request" &&
    context.eventName !== "pull_request_target"
  ) {
    // Fallback to environment variables for manual triggers
    const githubRef = process.env.GITHUB_REF;
    const githubRepository = process.env.GITHUB_REPOSITORY;

    if (!githubRef) throw new Error("missing GITHUB_REF");
    if (!githubRepository) throw new Error("missing GITHUB_REPOSITORY");

    // Extract PR number from refs/pull/42/merge or refs/pull/42/head
    const prMatch = githubRef.match(/^refs\/pull\/(\d+)\/(merge|head)$/);
    if (!prMatch) {
      throw new Error(`GITHUB_REF is not a pull request ref: ${githubRef}`);
    }

    const prNumber = parseInt(prMatch[1], 10);
    const ref = githubRef
      .replace(/^refs\/pull\/\d+\//, "")
      .replace(/\/(merge|head)$/, "");

    // Try to get PR author from GitHub Actions inputs
    const author = core.getInput("pr-author") || undefined;

    return { prNumber, repository: githubRepository, ref, author };
  }

  // Use context payload for PR events
  const prNumber = context.payload.pull_request?.number;
  const repository = context.payload.repository?.full_name;
  const ref = context.payload.pull_request?.head?.ref;
  const author =
    context.payload.pull_request?.user?.login ||
    core.getInput("pr-author") ||
    undefined;

  if (!prNumber || !repository || !ref) {
    throw new Error("Unable to extract PR information from context");
  }

  return { prNumber, repository, ref, author };
}

async function run(): Promise<void> {
  try {
    const { prNumber, repository, ref, author } = extractPRInfoFromContext();

    //comes from {{secrets.GITHUB_TOKEN}}
    const token = core.getInput("repo-token", { required: true });
    const config = getConfig();

    // Use @actions/github's getOctokit for standardized GitHub client
    const octokit = getOctokit(token);

    // Create service implementations
    const logger = new LoggerImpl();
    const actionOutputs = new ActionOutputsImpl();
    const githubService = new GitHubServiceImpl(octokit, { repository, ref });

    // Create lottery instance with dependency injection
    const lottery = new Lottery({
      logger,
      actionOutputs,
      githubService,
      config,
      env: { repository, ref },
      prInfo: { prNumber, repository, ref, author },
    });

    // Run the lottery
    await lottery.run();
  } catch (error: unknown) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
