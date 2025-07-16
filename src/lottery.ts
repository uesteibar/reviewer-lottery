import * as core from "@actions/core";
import type { getOctokit } from "@actions/github";
import type { Config } from "./config";

type Octokit = ReturnType<typeof getOctokit>;

export interface Pull {
	user: { login: string } | null;
	number: number;
}

interface Env {
	repository: string;
	ref: string;
}

export class Lottery {
	octokit: Octokit;
	config: Config;
	env: Env;
	pr: Pull | undefined | null;
	prInfo?: {
		prNumber: number;
		repository: string;
		ref: string;
		author?: string;
	};

	constructor({
		octokit,
		config,
		env,
		prInfo,
	}: {
		octokit: Octokit;
		config: Config;
		env: Env;
		prInfo?: {
			prNumber: number;
			repository: string;
			ref: string;
			author?: string;
		};
	}) {
		this.octokit = octokit;
		this.config = config;
		this.env = {
			repository: env.repository,
			ref: env.ref,
		};
		this.pr = undefined;
		this.prInfo = prInfo;
	}

	async run(): Promise<void> {
		core.startGroup("🎯 Reviewer Lottery - Starting");

		try {
			core.debug("Checking if PR is ready for review assignment");
			const ready = await this.isReadyToReview();

			if (ready) {
				core.debug("PR is ready, selecting reviewers");
				const reviewers = await this.selectReviewers();

				core.info(
					`Selected ${reviewers.length} reviewers: ${reviewers.join(", ")}`,
				);

				// Set action outputs
				core.setOutput("reviewers", reviewers.join(","));
				core.setOutput("reviewer-count", reviewers.length.toString());

				if (reviewers.length > 0) {
					core.startGroup("📝 Assigning reviewers");
					core.setOutput("assignment-successful", "true");

					// Add to summary
					await this.addSuccessSummary(reviewers);

					try {
						await this.setReviewers(reviewers);
						core.info("✅ Successfully assigned reviewers to PR");
					} finally {
						core.endGroup();
					}
				} else {
					core.setOutput("assignment-successful", "false");
					core.info("⚠️ No reviewers selected");

					// Add to summary
					await this.addNoReviewersSummary();
				}
			} else {
				core.setOutput("assignment-successful", "false");
				core.setOutput("reviewers", "");
				core.setOutput("reviewer-count", "0");
				core.info("❌ PR is not ready for review assignment");
			}
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));

			// Set error outputs
			core.setOutput("assignment-successful", "false");
			core.setOutput("reviewers", "");
			core.setOutput("reviewer-count", "0");
		}

		core.endGroup();
	}

	async isReadyToReview(): Promise<boolean> {
		try {
			const pr = await this.getPR();
			return !!pr;
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	async setReviewers(reviewers: string[]): Promise<object> {
		const ownerAndRepo = this.getOwnerAndRepo();
		const pr = this.getPRNumber();

		return this.octokit.rest.pulls.requestReviewers({
			...ownerAndRepo,
			pull_number: pr,
			reviewers: reviewers.filter((r: string | undefined) => !!r),
		});
	}

	async getExistingReviewers(): Promise<string[]> {
		const ownerAndRepo = this.getOwnerAndRepo();
		const pr = this.getPRNumber();

		try {
			const { data } = await this.octokit.rest.pulls.listRequestedReviewers({
				...ownerAndRepo,
				pull_number: pr,
			});

			return data.users.map((user: { login: string }) => user.login);
		} catch (error: unknown) {
			core.warning(
				`Failed to get existing reviewers: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	async selectReviewers(): Promise<string[]> {
		core.startGroup("🎲 Selecting reviewers");

		const author = await this.getPRAuthor();
		const existingReviewers = await this.getExistingReviewers();

		core.info(`PR author: ${author}`);
		core.info(
			`Existing reviewers: ${existingReviewers.length > 0 ? existingReviewers.join(", ") : "none"}`,
		);

		try {
			if (this.config.selection_rules) {
				const authorGroup = this.getAuthorGroup(author);
				core.info(`Author group: ${authorGroup || "none"}`);

				const result = this.selectReviewersWithRules(author, existingReviewers);

				// Set output for applied rule info
				core.setOutput("pr-author", author);
				core.setOutput("author-group", authorGroup || "none");
				core.setOutput("existing-reviewers", existingReviewers.join(","));

				core.debug(`Selection result: ${result.join(", ")}`);
				core.endGroup();
				return result;
			}

			core.info("No selection rules configured");
			core.endGroup();
			return [];
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));
			core.endGroup();
			return [];
		}
	}

	private selectReviewersWithRules(
		author: string,
		existingReviewers: string[],
	): string[] {
		const authorGroup = this.getAuthorGroup(author);
		const rules = this.config.selection_rules;

		if (!rules) {
			return [];
		}

		// Find applicable rule for author's group
		const applicableRule = rules.by_author_group?.find(
			(rule) => rule.group === authorGroup,
		);

		// Determine which rule to use based on author's group membership
		let fromClause: Record<string, number> | undefined;

		if (authorGroup === null) {
			// Author is not in any group
			fromClause = rules.non_group_members?.from || rules.default?.from;
		} else {
			// Author is in a group
			fromClause = applicableRule?.from || rules.default?.from;
		}

		if (!fromClause) {
			return [];
		}

		return this.selectFromMultipleGroups(
			fromClause,
			author,
			authorGroup,
			existingReviewers,
		);
	}

	private selectFromMultipleGroups(
		fromClause: Record<string, number>,
		author: string,
		authorGroup: string | null,
		existingReviewers: string[],
	): string[] {
		let selected: string[] = [];

		for (const [groupKey, count] of Object.entries(fromClause)) {
			if (count <= 0) continue;

			const targetGroups = this.resolveGroupSelection(groupKey, authorGroup);
			const candidates = this.getCandidatesFromGroups(targetGroups);

			// Count existing reviewers from the target groups
			const existingFromGroups = existingReviewers.filter((reviewer) =>
				candidates.includes(reviewer),
			);

			// Calculate how many more reviewers we need from this group
			const remainingNeeded = Math.max(0, count - existingFromGroups.length);

			if (remainingNeeded > 0) {
				const picks = this.pickRandom(
					candidates,
					remainingNeeded,
					selected.concat(author, ...existingReviewers),
				);
				selected = selected.concat(picks);
			}
		}

		return selected;
	}

	private resolveGroupSelection(
		groupKey: string,
		_authorGroup: string | null,
	): string[] {
		if (groupKey === "*") {
			// All groups
			return this.config.groups.map((g) => g.name);
		}

		if (groupKey.startsWith("!")) {
			// Exclude specific group(s) - support comma-separated list
			const excludeGroups = groupKey
				.substring(1)
				.split(",")
				.map((g) => g.trim());
			return this.config.groups
				.map((g) => g.name)
				.filter((name) => !excludeGroups.includes(name));
		}

		// Specific group
		return [groupKey];
	}

	private getCandidatesFromGroups(groupNames: string[]): string[] {
		const candidates: string[] = [];

		for (const groupName of groupNames) {
			const group = this.config.groups.find((g) => g.name === groupName);
			if (group) {
				candidates.push(...group.usernames);
			}
		}

		return candidates;
	}

	private async addSuccessSummary(reviewers: string[]): Promise<void> {
		const author = await this.getPRAuthor();
		const authorGroup = this.getAuthorGroup(author);
		const existingReviewers = await this.getExistingReviewers();

		await core.summary
			.addHeading("🎯 Reviewer Lottery Results")
			.addTable([
				[
					{ data: "Field", header: true },
					{ data: "Value", header: true },
				],
				["PR Author", author],
				["Author Group", authorGroup || "none"],
				[
					"Existing Reviewers",
					existingReviewers.length > 0 ? existingReviewers.join(", ") : "none",
				],
				["Selected Reviewers", reviewers.join(", ")],
				["Total Reviewers", reviewers.length.toString()],
				["Status", "✅ Successfully assigned"],
			])
			.write();
	}

	private async addNoReviewersSummary(): Promise<void> {
		const author = await this.getPRAuthor();
		const authorGroup = this.getAuthorGroup(author);
		const existingReviewers = await this.getExistingReviewers();

		await core.summary
			.addHeading("🎯 Reviewer Lottery Results")
			.addTable([
				[
					{ data: "Field", header: true },
					{ data: "Value", header: true },
				],
				["PR Author", author],
				["Author Group", authorGroup || "none"],
				[
					"Existing Reviewers",
					existingReviewers.length > 0 ? existingReviewers.join(", ") : "none",
				],
				["Selected Reviewers", "none"],
				["Total Reviewers", "0"],
				["Status", "⚠️ No reviewers selected"],
			])
			.write();
	}

	pickRandom(items: string[], n: number, ignore: string[]): string[] {
		const picks: string[] = [];

		const candidates = items.filter((item) => !ignore.includes(item));

		while (picks.length < n && candidates.length > 0) {
			const random = Math.floor(Math.random() * candidates.length);
			const pick = candidates.splice(random, 1)[0];

			if (!picks.includes(pick)) picks.push(pick);
		}

		return picks;
	}

	async getPRAuthor(): Promise<string> {
		try {
			// If we have PR author from environment, use it directly
			if (this.prInfo?.author) {
				return this.prInfo.author;
			}

			const pr = await this.getPR();

			// If we have PR info but no author cached, get it from API
			if (this.prInfo && (!pr?.user || !pr.user.login)) {
				const { data } = await this.octokit.rest.pulls.get({
					...this.getOwnerAndRepo(),
					pull_number: this.prInfo.prNumber,
				});

				// Cache the full PR info with author
				this.pr = {
					number: data.number,
					user: data.user,
				};

				return data.user?.login ?? "";
			}

			return pr?.user?.login ?? "";
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));
		}

		return "";
	}

	getOwnerAndRepo(): { owner: string; repo: string } {
		const [owner, repo] = this.env.repository.split("/");

		return { owner, repo };
	}

	getPRNumber(): number {
		return Number(this.pr?.number);
	}

	getAuthorGroup(author: string): string | null {
		for (const group of this.config.groups) {
			if (group.usernames.includes(author)) {
				return group.name;
			}
		}
		return null;
	}

	async getPR(): Promise<Pull | undefined> {
		if (this.pr) return this.pr;

		// If we have PR info from environment variables, use it directly
		if (this.prInfo) {
			this.pr = {
				number: this.prInfo.prNumber,
				user: null, // We'll get the author from API only when needed
			};
			return this.pr;
		}

		// Fallback to API call if no direct PR info available
		try {
			const { data } = await this.octokit.rest.pulls.list({
				...this.getOwnerAndRepo(),
			});

			this.pr = data.find(
				({ head: { ref } }: { head: { ref: string } }) => ref === this.env.ref,
			);

			if (!this.pr) {
				throw new Error(`PR matching ref not found: ${this.env.ref}`);
			}

			return this.pr;
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));

			return undefined;
		}
	}
}

export const runLottery = async (
	octokit: Octokit,
	config: Config,
	prInfo?: {
		prNumber: number;
		repository: string;
		ref: string;
		author?: string;
	},
	env = {
		repository: process.env.GITHUB_REPOSITORY || "",
		ref: process.env.GITHUB_HEAD_REF || "",
	},
): Promise<void> => {
	const lottery = new Lottery({ octokit, config, env, prInfo });

	await lottery.run();
};
