import type { Config } from "./config";
import type {
	ActionOutputs,
	Env,
	GitHubService,
	Logger,
	PRInfo,
	Pull,
} from "./interfaces";

export class Lottery {
	private logger: Logger;
	private actionOutputs: ActionOutputs;
	private githubService: GitHubService;
	config: Config;
	env: Env;
	pr: Pull | undefined | null;
	prInfo?: PRInfo;

	constructor({
		logger,
		actionOutputs,
		githubService,
		config,
		env,
		prInfo,
	}: {
		logger: Logger;
		actionOutputs: ActionOutputs;
		githubService: GitHubService;
		config: Config;
		env: Env;
		prInfo?: PRInfo;
	}) {
		this.logger = logger;
		this.actionOutputs = actionOutputs;
		this.githubService = githubService;
		this.config = config;
		this.env = {
			repository: env.repository,
			ref: env.ref,
		};
		this.pr = undefined;
		this.prInfo = prInfo;
	}

	async run(): Promise<void> {
		this.logger.startGroup("🎯 Reviewer Lottery - Starting");

		try {
			this.logger.debug("Checking if PR is ready for review assignment");
			const ready = await this.isReadyToReview();

			if (ready) {
				this.logger.debug("PR is ready, selecting reviewers");
				const reviewers = await this.selectReviewers();

				this.logger.info(
					`Selected ${reviewers.length} reviewers: ${reviewers.join(", ")}`,
				);

				// Set action outputs
				this.actionOutputs.setOutput("reviewers", reviewers.join(","));
				this.actionOutputs.setOutput(
					"reviewer-count",
					reviewers.length.toString(),
				);

				if (reviewers.length > 0) {
					this.logger.startGroup("📝 Assigning reviewers");
					this.actionOutputs.setOutput("assignment-successful", "true");

					// Add to summary
					await this.addSuccessSummary(reviewers);

					try {
						await this.setReviewers(reviewers);
						this.logger.info("✅ Successfully assigned reviewers to PR");
					} finally {
						this.logger.endGroup();
					}
				} else {
					this.actionOutputs.setOutput("assignment-successful", "false");
					this.logger.info("⚠️ No reviewers selected");

					// Add to summary
					await this.addNoReviewersSummary();
				}
			} else {
				this.actionOutputs.setOutput("assignment-successful", "false");
				this.actionOutputs.setOutput("reviewers", "");
				this.actionOutputs.setOutput("reviewer-count", "0");
				this.logger.info("❌ PR is not ready for review assignment");
			}
		} catch (error: unknown) {
			this.logger.error(error instanceof Error ? error.message : String(error));
			this.actionOutputs.setFailed(
				error instanceof Error ? error.message : String(error),
			);

			// Set error outputs
			this.actionOutputs.setOutput("assignment-successful", "false");
			this.actionOutputs.setOutput("reviewers", "");
			this.actionOutputs.setOutput("reviewer-count", "0");
		}

		this.logger.endGroup();
	}

	async isReadyToReview(): Promise<boolean> {
		try {
			const pr = await this.getPR();
			return !!pr;
		} catch (error: unknown) {
			this.logger.error(error instanceof Error ? error.message : String(error));
			this.actionOutputs.setFailed(
				error instanceof Error ? error.message : String(error),
			);
			return false;
		}
	}

	async setReviewers(reviewers: string[]): Promise<object> {
		const pr = this.getPRNumber();
		return this.githubService.setReviewers(
			pr,
			reviewers.filter((r: string | undefined) => !!r),
		);
	}

	async getExistingReviewers(): Promise<string[]> {
		const pr = this.getPRNumber();
		try {
			return await this.githubService.getExistingReviewers(pr);
		} catch (error: unknown) {
			this.logger.warning(
				`Failed to get existing reviewers: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	async selectReviewers(): Promise<string[]> {
		this.logger.startGroup("🎲 Selecting reviewers");

		const author = await this.getPRAuthor();
		const existingReviewers = await this.getExistingReviewers();

		this.logger.info(`PR author: ${author}`);
		this.logger.info(
			`Existing reviewers: ${existingReviewers.length > 0 ? existingReviewers.join(", ") : "none"}`,
		);

		try {
			if (this.config.selection_rules) {
				const authorGroup = this.getAuthorGroup(author);
				this.logger.info(`Author group: ${authorGroup || "none"}`);

				const result = this.selectReviewersWithRules(author, existingReviewers);

				// Set output for applied rule info
				this.actionOutputs.setOutput("pr-author", author);
				this.actionOutputs.setOutput("author-group", authorGroup || "none");
				this.actionOutputs.setOutput(
					"existing-reviewers",
					existingReviewers.join(","),
				);

				this.logger.debug(`Selection result: ${result.join(", ")}`);
				this.logger.endGroup();
				return result;
			}

			this.logger.info("No selection rules configured");
			this.logger.endGroup();
			return [];
		} catch (error: unknown) {
			this.logger.error(error instanceof Error ? error.message : String(error));
			this.actionOutputs.setFailed(
				error instanceof Error ? error.message : String(error),
			);
			this.logger.endGroup();
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

		await this.actionOutputs.addSummary("🎯 Reviewer Lottery Results", [
			["PR Author", author],
			["Author Group", authorGroup || "none"],
			[
				"Existing Reviewers",
				existingReviewers.length > 0 ? existingReviewers.join(", ") : "none",
			],
			["Selected Reviewers", reviewers.join(", ")],
			["Total Reviewers", reviewers.length.toString()],
			["Status", "✅ Successfully assigned"],
		]);
	}

	private async addNoReviewersSummary(): Promise<void> {
		const author = await this.getPRAuthor();
		const authorGroup = this.getAuthorGroup(author);
		const existingReviewers = await this.getExistingReviewers();

		await this.actionOutputs.addSummary("🎯 Reviewer Lottery Results", [
			["PR Author", author],
			["Author Group", authorGroup || "none"],
			[
				"Existing Reviewers",
				existingReviewers.length > 0 ? existingReviewers.join(", ") : "none",
			],
			["Selected Reviewers", "none"],
			["Total Reviewers", "0"],
			["Status", "⚠️ No reviewers selected"],
		]);
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
				const author = await this.githubService.getPRAuthor(
					this.prInfo.prNumber,
				);

				// Cache the full PR info with author
				this.pr = {
					number: this.prInfo.prNumber,
					user: { login: author },
				};

				return author;
			}

			return pr?.user?.login ?? "";
		} catch (error: unknown) {
			this.logger.error(error instanceof Error ? error.message : String(error));
			this.actionOutputs.setFailed(
				error instanceof Error ? error.message : String(error),
			);
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
			this.pr = await this.githubService.findPRByRef(this.env.ref);

			if (!this.pr) {
				throw new Error(`PR matching ref not found: ${this.env.ref}`);
			}

			return this.pr;
		} catch (error: unknown) {
			this.logger.error(error instanceof Error ? error.message : String(error));
			this.actionOutputs.setFailed(
				error instanceof Error ? error.message : String(error),
			);

			return undefined;
		}
	}
}
