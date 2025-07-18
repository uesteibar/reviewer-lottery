import type { Config } from "./config";
import { ReviewerSelector } from "./core/reviewer-selector";
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
	private reviewerSelector: ReviewerSelector;
	config: Config;
	env: Env;
	pr: Pull | undefined | null;
	prInfo?: PRInfo;

	// For testing purposes - access to reviewer selector
	get reviewerSelectorForTesting(): ReviewerSelector {
		return this.reviewerSelector;
	}

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
		this.reviewerSelector = new ReviewerSelector(config);
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
				const authorGroup = this.reviewerSelector.getAuthorGroup(author);
				this.logger.info(`Author group: ${authorGroup || "none"}`);

				// Use the ReviewerSelector for core logic
				const selectionResult = this.reviewerSelector.selectReviewers(
					author,
					existingReviewers,
				);

				// Set output for applied rule info
				this.actionOutputs.setOutput("pr-author", author);
				this.actionOutputs.setOutput("author-group", authorGroup || "none");
				this.actionOutputs.setOutput(
					"existing-reviewers",
					existingReviewers.join(","),
				);

				// Log the selection process
				for (const step of selectionResult.process) {
					this.logger.debug(`Step ${step.step}: ${step.description}`);
				}

				this.logger.debug(
					`Selection result: ${selectionResult.selectedReviewers.join(", ")}`,
				);
				this.logger.endGroup();
				return selectionResult.selectedReviewers;
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

	private async addSuccessSummary(reviewers: string[]): Promise<void> {
		const author = await this.getPRAuthor();
		const authorGroup = this.reviewerSelector.getAuthorGroup(author);
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
		const authorGroup = this.reviewerSelector.getAuthorGroup(author);
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
