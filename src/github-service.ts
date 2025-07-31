import type { getOctokit } from "@actions/github";
import type { Env, GitHubService, Pull } from "./interfaces";

type Octokit = ReturnType<typeof getOctokit>;

export class GitHubServiceImpl implements GitHubService {
  private octokit: Octokit;
  private env: Env;

  constructor(octokit: Octokit, env: Env) {
    this.octokit = octokit;
    this.env = env;
  }

  async setReviewers(prNumber: number, reviewers: string[]): Promise<object> {
    const ownerAndRepo = this.getOwnerAndRepo();

    return this.octokit.rest.pulls.requestReviewers({
      ...ownerAndRepo,
      pull_number: prNumber,
      reviewers: reviewers.filter((r: string | undefined) => !!r),
    });
  }

  async getExistingReviewers(prNumber: number): Promise<string[]> {
    const ownerAndRepo = this.getOwnerAndRepo();

    try {
      const { data } = await this.octokit.rest.pulls.listRequestedReviewers({
        ...ownerAndRepo,
        pull_number: prNumber,
      });

      return data.users.map((user: { login: string }) => user.login);
    } catch (error: unknown) {
      // Return empty array on error - let caller handle logging
      throw new Error(
        `Failed to get existing reviewers: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getPRAuthor(prNumber: number): Promise<string> {
    const ownerAndRepo = this.getOwnerAndRepo();

    try {
      const { data } = await this.octokit.rest.pulls.get({
        ...ownerAndRepo,
        pull_number: prNumber,
      });

      return data.user?.login ?? "";
    } catch (error: unknown) {
      throw new Error(
        `Failed to get PR author: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async findPRByRef(ref: string): Promise<Pull | undefined> {
    const ownerAndRepo = this.getOwnerAndRepo();

    try {
      const { data } = await this.octokit.rest.pulls.list({
        ...ownerAndRepo,
      });

      const pr = data.find(
        ({ head: { ref: prRef } }: { head: { ref: string } }) => prRef === ref,
      );

      if (!pr) {
        throw new Error(`PR matching ref not found: ${ref}`);
      }

      return {
        number: pr.number,
        user: pr.user,
      };
    } catch (error: unknown) {
      throw new Error(
        `Failed to find PR by ref: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getOwnerAndRepo(): { owner: string; repo: string } {
    const [owner, repo] = this.env.repository.split("/");

    return { owner, repo };
  }
}
