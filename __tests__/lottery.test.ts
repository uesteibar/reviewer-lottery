import { Octokit } from "@octokit/rest";
import nock from "nock";
import { type Pull, runLottery } from "../src/lottery";

// Test constants
const TEST_CONFIG = {
	REPOSITORY: "company/reviewer-lottery-test",
	PR_NUMBER: 42,
	REF: "refs/pull/feature-branch",
} as const;

const octokit = new Octokit();

// Scenario builders - focusing on user intent and business context
interface TestScenario {
	author: string;
	teams: Array<{
		name: string;
		members: string[];
	}>;
	prState?: "draft" | "ready";
}

const createScenario = (scenario: TestScenario) => {
	const pull: Pull = {
		number: TEST_CONFIG.PR_NUMBER,
		user: { login: scenario.author },
		draft: scenario.prState === "draft",
	};

	const config = {
		groups: scenario.teams.map((team) => ({
			name: team.name,
			usernames: team.members,
		})),
	};

	return { pull, config };
};

// GitHub API test doubles
const givenGitHubAPI = () => {
	const setupPullRequest = (pull: Pull) => {
		const pullWithHead = { ...pull, head: { ref: TEST_CONFIG.REF } };
		return nock("https://api.github.com")
			.get("/repos/company/reviewer-lottery-test/pulls")
			.reply(200, [pullWithHead]);
	};

	const expectReviewerAssignment = (expectation: {
		count?: number;
		shouldInclude?: string[];
		shouldExclude?: string[];
	}) => {
		return nock("https://api.github.com")
			.post(
				`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`,
				(body): boolean => {
					const { reviewers } = body;

					if (expectation.count !== undefined) {
						expect(reviewers).toHaveLength(expectation.count);
					}

					if (expectation.shouldInclude) {
						expectation.shouldInclude.forEach((reviewer) => {
							expect(reviewers).toContain(reviewer);
						});
					}

					if (expectation.shouldExclude) {
						expectation.shouldExclude.forEach((reviewer) => {
							expect(reviewers).not.toContain(reviewer);
						});
					}

					return true;
				},
			)
			.reply(200, { number: TEST_CONFIG.PR_NUMBER });
	};

	return { setupPullRequest, expectReviewerAssignment };
};

const whenLotteryRuns = async (config: {
	groups: Array<{
		name: string;
		usernames: string[];
	}>;
	selection_rules?: {
		default?: {
			from: Record<string, number>;
		};
		by_author_group?: Array<{
			group: string;
			from: Record<string, number>;
		}>;
	};
}) => {
	await runLottery(octokit, config, {
		repository: TEST_CONFIG.REPOSITORY,
		ref: TEST_CONFIG.REF,
	});
};

describe("Reviewer Lottery System", () => {
	afterEach(() => {
		nock.cleanAll();
	});

	describe("Basic reviewer assignment", () => {
		test("assigns reviewers excluding the PR author", async () => {
			// Given: a development team with multiple members
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie", "diana"],
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "backend-team",
							from: {
								"backend-team": 2,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const reviewerMock = api.expectReviewerAssignment({
				count: 2,
				shouldExclude: ["alice"], // Author should never be assigned as reviewer
			});

			// When: Alice opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: reviewers are assigned but Alice is excluded
			pullMock.done();
			reviewerMock.done();
		});

		test("distributes reviewers across multiple teams without duplication", async () => {
			// Given: multiple teams with overlapping members
			const scenario = createScenario({
				author: "eve", // Author in both teams
				teams: [
					{
						name: "frontend-team",
						members: ["alice", "bob", "eve"],
					},
					{
						name: "backend-team",
						members: ["charlie", "diana", "eve"],
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "frontend-team",
							from: {
								"frontend-team": 2,
								"backend-team": 2,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const reviewerMock = api.expectReviewerAssignment({
				count: 4, // 2 from each team
				shouldExclude: ["eve"], // Author excluded
			});

			// When: Eve opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: reviewers are selected from both teams without duplicates
			pullMock.done();
			reviewerMock.done();
		});
	});

	describe("Draft PR workflow", () => {
		test("skips reviewer assignment for draft PRs", async () => {
			// Given: a team that normally assigns reviewers
			const scenario = createScenario({
				author: "bob",
				teams: [
					{
						name: "dev-team",
						members: ["alice", "bob", "charlie"],
					},
				],
				prState: "draft",
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "dev-team",
							from: {
								"dev-team": 2,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);

			// When: Bob opens a draft PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: no reviewers are assigned (draft PRs don't need review yet)
			pullMock.done();
			// No reviewer assignment call should have been made
		});
	});

	describe("Edge cases in team composition", () => {
		test("handles teams where only the author is available", async () => {
			// Given: teams with limited availability
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "available-team",
						members: ["bob"],
					},
					{
						name: "author-only-team",
						members: ["alice"], // Only the author
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "author-only-team",
							from: {
								"available-team": 1,
								"author-only-team": 1,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const reviewerMock = api.expectReviewerAssignment({
				count: 1, // Only bob can be assigned
				shouldInclude: ["bob"],
				shouldExclude: ["alice"],
			});

			// When: Alice opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: only available reviewers are assigned
			pullMock.done();
			reviewerMock.done();
		});
	});

	describe("Enhanced selection rules", () => {
		describe("Default rules for non-team members", () => {
			test("applies default selection rules when author is not in any team", async () => {
				// Given: configuration with new selection_rules format
				const scenario = createScenario({
					author: "external-contributor",
					teams: [
						{
							name: "backend",
							members: ["alice", "bob"],
						},
						{
							name: "frontend",
							members: ["charlie", "diana"],
						},
					],
				});

				const configWithRules = {
					...scenario.config,
					selection_rules: {
						default: {
							from: {
								backend: 1,
								frontend: 2,
							},
						},
					},
				};

				const api = givenGitHubAPI();
				const pullMock = api.setupPullRequest(scenario.pull);
				const reviewerMock = api.expectReviewerAssignment({
					count: 3, // 1 from backend + 2 from frontend
					shouldExclude: ["external-contributor"],
				});

				// When: external contributor opens PR
				await whenLotteryRuns(configWithRules);

				// Then: default rules are applied
				pullMock.done();
				reviewerMock.done();
			});
		});

		describe("Group-specific rules", () => {
			test("applies group-specific rules for team members", async () => {
				// Given: configuration with group-specific rules
				const scenario = createScenario({
					author: "alice", // Member of backend team
					teams: [
						{
							name: "backend",
							members: ["alice", "bob", "charlie"],
						},
						{
							name: "frontend",
							members: ["diana", "eve"],
						},
					],
				});

				const configWithRules = {
					...scenario.config,
					selection_rules: {
						default: {
							from: {
								backend: 1,
								frontend: 1,
							},
						},
						by_author_group: [
							{
								group: "backend",
								from: {
									backend: 2, // 2 from same team
									frontend: 1, // 1 from frontend team
								},
							},
						],
					},
				};

				const api = givenGitHubAPI();
				const pullMock = api.setupPullRequest(scenario.pull);
				const reviewerMock = api.expectReviewerAssignment({
					count: 3, // 2 from backend + 1 from frontend
					shouldExclude: ["alice"],
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: group-specific rules are applied
				pullMock.done();
				reviewerMock.done();
			});
		});

		describe("Special keyword support", () => {
			test('supports "*" keyword for all groups', async () => {
				// Given: configuration using "*" keyword
				const scenario = createScenario({
					author: "alice",
					teams: [
						{
							name: "backend",
							members: ["alice", "bob"],
						},
						{
							name: "frontend",
							members: ["charlie", "diana"],
						},
						{
							name: "ops",
							members: ["eve", "frank"],
						},
					],
				});

				const configWithRules = {
					...scenario.config,
					selection_rules: {
						by_author_group: [
							{
								group: "backend",
								from: {
									"*": 3, // 3 from all groups
								},
							},
						],
					},
				};

				const api = givenGitHubAPI();
				const pullMock = api.setupPullRequest(scenario.pull);
				const reviewerMock = api.expectReviewerAssignment({
					count: 3,
					shouldExclude: ["alice"],
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: reviewers are selected from all groups
				pullMock.done();
				reviewerMock.done();
			});

			test('supports "!group" keyword for exclusion', async () => {
				// Given: configuration using "!group" keyword
				const scenario = createScenario({
					author: "alice",
					teams: [
						{
							name: "backend",
							members: ["alice", "bob"],
						},
						{
							name: "frontend",
							members: ["charlie", "diana"],
						},
						{
							name: "ops",
							members: ["eve", "frank"],
						},
					],
				});

				const configWithRules = {
					...scenario.config,
					selection_rules: {
						by_author_group: [
							{
								group: "backend",
								from: {
									backend: 1, // 1 from backend
									"!backend": 2, // 2 from non-backend groups
								},
							},
						],
					},
				};

				const api = givenGitHubAPI();
				const pullMock = api.setupPullRequest(scenario.pull);
				const reviewerMock = api.expectReviewerAssignment({
					count: 3,
					shouldExclude: ["alice"],
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: reviewers are selected from backend + non-backend groups
				pullMock.done();
				reviewerMock.done();
			});
		});
	});
});
