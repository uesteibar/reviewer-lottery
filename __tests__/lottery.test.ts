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
}

const createScenario = (scenario: TestScenario) => {
	const pull: Pull = {
		number: TEST_CONFIG.PR_NUMBER,
		user: { login: scenario.author },
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

	const setupExistingReviewers = (existingReviewers: string[] = []) => {
		return nock("https://api.github.com")
			.get(
				`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`,
			)
			.reply(200, {
				users: existingReviewers.map((login) => ({ login })),
				teams: [],
			});
	};

	return { setupPullRequest, expectReviewerAssignment, setupExistingReviewers };
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
		non_group_members?: {
			from: Record<string, number>;
		};
	};
}) => {
	await runLottery(octokit, config, {
		repository: TEST_CONFIG.REPOSITORY,
		ref: TEST_CONFIG.REF,
	});
};

describe("Reviewer Lottery System", () => {
	beforeEach(() => {
		// Setup default empty existing reviewers response that persists for all tests
		nock("https://api.github.com")
			.persist()
			.get(`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`)
			.reply(200, {
				users: [],
				teams: [],
			});
	});

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

	describe("Existing reviewers handling", () => {
		test("reduces additional reviewers when group members are already assigned", async () => {
			// Given: backend team with existing reviewer from same group
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
								"backend-team": 2, // Want 2 reviewers from backend-team
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers(["bob"]); // Bob is already assigned
			const reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should only select 1 more (2 required - 1 existing = 1)
				shouldExclude: ["alice", "bob"], // Exclude author and existing reviewer
			});

			// When: Alice opens a PR with Bob already assigned as reviewer
			await whenLotteryRuns(configWithRules);

			// Then: only 1 additional reviewer is selected
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});

		test("assigns no additional reviewers when requirement is already met", async () => {
			// Given: backend team with sufficient existing reviewers
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
								"backend-team": 2, // Want 2 reviewers from backend-team
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"bob",
				"charlie",
			]); // 2 already assigned

			// Expect no new reviewer assignment since requirement is already met
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: Alice opens a PR with Bob and Charlie already assigned as reviewers
			await whenLotteryRuns(configWithRules);

			// Then: no additional reviewers are selected
			pullMock.done();
			existingReviewersMock.done();
		});

		test("handles existing reviewers across multiple groups", async () => {
			// Given: multiple teams with existing reviewers from different groups
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
					{
						name: "frontend-team",
						members: ["diana", "eve", "frank"],
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
								"backend-team": 2, // Want 2 from backend
								"frontend-team": 2, // Want 2 from frontend
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"bob",
				"diana",
			]); // 1 from each group
			const reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 2 more (1 from each group)
				shouldExclude: ["alice", "bob", "diana"], // Exclude author and existing reviewers
			});

			// When: Alice opens a PR with Bob (backend) and Diana (frontend) already assigned
			await whenLotteryRuns(configWithRules);

			// Then: 1 additional reviewer from each group is selected
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});

		test("handles existing reviewers with non-group members rule", async () => {
			// Given: external contributor with existing reviewers
			const scenario = createScenario({
				author: "external-contributor",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
					{
						name: "frontend-team",
						members: ["diana", "eve"],
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					non_group_members: {
						from: {
							"backend-team": 2,
							"frontend-team": 1,
						},
					},
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"alice",
				"diana",
			]); // 1 from backend, 1 from frontend
			const reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should select 1 more from backend (2 required - 1 existing = 1)
				shouldExclude: ["external-contributor", "alice", "diana"], // Exclude author and existing reviewers
			});

			// When: external contributor opens a PR with existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: additional reviewers are selected based on remaining need
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});

		test("handles existing reviewers with default rule fallback", async () => {
			// Given: author with no specific group rules, falling back to default
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
					{
						name: "frontend-team",
						members: ["diana", "eve", "frank"],
					},
					{
						name: "ops-team",
						members: ["george", "helen"],
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					default: {
						from: {
							"frontend-team": 2,
							"ops-team": 1,
						},
					},
					by_author_group: [
						{
							group: "other-team", // No rule for backend-team, so will use default
							from: {
								"other-team": 1,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"diana",
				"george",
			]); // 1 from frontend, 1 from ops (requirements already met)
			
			// Expect no new reviewer assignment since default rule requirements are met
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: Alice (backend member) opens PR, falls back to default rule
			await whenLotteryRuns(configWithRules);

			// Then: no additional reviewers are selected as requirements are met
			pullMock.done();
			existingReviewersMock.done();
		});

		test("handles existing reviewers with wildcard (*) selection", async () => {
			// Given: configuration using "*" keyword with existing reviewers
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
					{
						name: "frontend-team",
						members: ["diana", "eve"],
					},
					{
						name: "ops-team",
						members: ["frank", "george"],
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
								"*": 4, // Want 4 reviewers from all groups
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"diana", // 1 from frontend
				"frank", // 1 from ops
			]); // 2 existing, need 2 more
			const reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 2 more (4 required - 2 existing = 2)
				shouldExclude: ["alice", "diana", "frank"], // Exclude author and existing reviewers
			});

			// When: Alice opens PR with wildcard selection and existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: additional reviewers are selected to meet total requirement
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});

		test("handles existing reviewers with exclusion (!group) selection", async () => {
			// Given: configuration using "!group" keyword with existing reviewers
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
					{
						name: "frontend-team",
						members: ["diana", "eve"],
					},
					{
						name: "ops-team",
						members: ["frank", "george"],
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
								"backend-team": 1, // 1 from backend
								"!backend-team": 2, // 2 from non-backend groups
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"bob", // 1 from backend (requirement met)
				"diana", // 1 from frontend (1 more needed from non-backend)
			]);
			const reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should select 1 more from non-backend groups
				shouldExclude: ["alice", "bob", "diana"], // Exclude author and existing reviewers
			});

			// When: Alice opens PR with exclusion selection and existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: additional reviewers are selected from non-backend groups only
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});

		test("handles existing reviewers not in any configured group", async () => {
			// Given: existing reviewers include users not in any group
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
					{
						name: "frontend-team",
						members: ["diana", "eve"],
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
								"frontend-team": 1,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"bob", // 1 from backend (need 1 more)
				"external-user", // Not in any group (should be ignored in counting)
			]);
			const reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 1 more from backend + 1 from frontend
				shouldExclude: ["alice", "bob", "external-user"], // Exclude author and all existing reviewers
			});

			// When: Alice opens PR with mix of group members and external reviewers
			await whenLotteryRuns(configWithRules);

			// Then: external reviewers are ignored in group counting
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});

		test("handles case where existing reviewers exceed requirements", async () => {
			// Given: more existing reviewers than required
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
								"backend-team": 2, // Want only 2 reviewers
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"bob",
				"charlie", 
				"diana", // 3 existing reviewers (more than required 2)
			]);
			
			// Expect no new reviewer assignment since requirement is already exceeded
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: Alice opens PR with more reviewers than required
			await whenLotteryRuns(configWithRules);

			// Then: no additional reviewers are selected
			pullMock.done();
			existingReviewersMock.done();
		});

		test("handles API error when fetching existing reviewers gracefully", async () => {
			// Given: API error when fetching existing reviewers
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
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
			
			// Mock API error for existing reviewers request
			const existingReviewersErrorMock = nock("https://api.github.com")
				.get(`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`)
				.reply(500, { message: "Internal Server Error" });

			// Should still proceed with normal reviewer selection (treating as no existing reviewers)
			const reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 2 reviewers as if no existing reviewers
				shouldExclude: ["alice"], // Only exclude author
			});

			// When: API error occurs while fetching existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: system gracefully handles error and proceeds with selection
			pullMock.done();
			existingReviewersErrorMock.done();
			reviewerMock.done();
		});

		test("handles empty groups with existing reviewers", async () => {
			// Given: configuration with empty groups and existing reviewers
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob"],
					},
					{
						name: "frontend-team",
						members: [], // Empty group
					},
					{
						name: "ops-team",
						members: ["charlie"],
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
								"backend-team": 1,
								"frontend-team": 2, // Can't select from empty group
								"ops-team": 1,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const pullMock = api.setupPullRequest(scenario.pull);
			const existingReviewersMock = api.setupExistingReviewers([
				"charlie", // 1 from ops (ops requirement met)
			]);
			const reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should select 1 from backend (frontend impossible, ops already satisfied)
				shouldExclude: ["alice", "charlie"], // Exclude author and existing reviewers
			});

			// When: Alice opens PR with empty groups in configuration
			await whenLotteryRuns(configWithRules);

			// Then: system handles empty groups gracefully
			pullMock.done();
			existingReviewersMock.done();
			reviewerMock.done();
		});
	});
});
