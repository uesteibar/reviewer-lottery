import * as core from "@actions/core";
import type { Octokit } from "@octokit/rest";
import type { Config } from "./config";

export interface Pull {
	user: { login: string } | null;
	number: number;
	draft?: boolean;
}
interface Env {
	repository: string;
	ref: string;
}

class Lottery {
	octokit: Octokit;
	config: Config;
	env: Env;
	pr: Pull | undefined | null;

	constructor({
		octokit,
		config,
		env,
	}: {
		octokit: Octokit;
		config: Config;
		env: Env;
	}) {
		this.octokit = octokit;
		this.config = config;
		this.env = {
			repository: env.repository,
			ref: env.ref,
		};
		this.pr = undefined;
	}

	async run(): Promise<void> {
		try {
			const ready = await this.isReadyToReview();
			if (ready) {
				const reviewers = await this.selectReviewers();
				reviewers.length > 0 && (await this.setReviewers(reviewers));
			}
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));
		}
	}

	async isReadyToReview(): Promise<boolean> {
		try {
			const pr = await this.getPR();
			return !!pr && !pr.draft;
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	async setReviewers(reviewers: string[]): Promise<object> {
		const ownerAndRepo = this.getOwnerAndRepo();
		const pr = this.getPRNumber();

		return this.octokit.pulls.requestReviewers({
			...ownerAndRepo,
			pull_number: pr,
			reviewers: reviewers.filter((r: string | undefined) => !!r),
		});
	}

	async selectReviewers(): Promise<string[]> {
		const author = await this.getPRAuthor();

		try {
			if (this.config.selection_rules) {
				return this.selectReviewersWithRules(author);
			}

			return [];
		} catch (error: unknown) {
			core.error(error instanceof Error ? error.message : String(error));
			core.setFailed(error instanceof Error ? error.message : String(error));
			return [];
		}
	}

	private selectReviewersWithRules(author: string): string[] {
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

		return this.selectFromMultipleGroups(fromClause, author, authorGroup);
	}

	private selectFromMultipleGroups(
		fromClause: Record<string, number>,
		author: string,
		authorGroup: string | null,
	): string[] {
		let selected: string[] = [];

		for (const [groupKey, count] of Object.entries(fromClause)) {
			if (count <= 0) continue;

			const targetGroups = this.resolveGroupSelection(groupKey, authorGroup);
			const candidates = this.getCandidatesFromGroups(targetGroups);

			const picks = this.pickRandom(candidates, count, selected.concat(author));
			selected = selected.concat(picks);
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
			// Exclude specific group
			const excludeGroup = groupKey.substring(1);
			return this.config.groups
				.map((g) => g.name)
				.filter((name) => name !== excludeGroup);
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

	pickRandom(items: string[], n: number, ignore: string[]): string[] {
		const picks: string[] = [];

		const candidates = items.filter((item) => !ignore.includes(item));

		while (picks.length < n) {
			const random = Math.floor(Math.random() * candidates.length);
			const pick = candidates.splice(random, 1)[0];

			if (!picks.includes(pick)) picks.push(pick);
		}

		return picks;
	}

	async getPRAuthor(): Promise<string> {
		try {
			const pr = await this.getPR();

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

		try {
			const { data } = await this.octokit.pulls.list({
				...this.getOwnerAndRepo(),
			});

			this.pr = data.find(({ head: { ref } }) => ref === this.env.ref);

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
	env = {
		repository: process.env.GITHUB_REPOSITORY || "",
		ref: process.env.GITHUB_HEAD_REF || "",
	},
): Promise<void> => {
	const lottery = new Lottery({ octokit, config, env });

	await lottery.run();
};
