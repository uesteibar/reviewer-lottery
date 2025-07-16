import { getOctokit } from "@actions/github";
import nock from "nock";
import { Lottery, type Pull, runLottery } from "../src/lottery";

// Mock @actions/core to prevent error messages during tests and test new functionality
jest.mock("@actions/core", () => ({
	error: jest.fn(),
	setFailed: jest.fn(),
	setOutput: jest.fn(),
	info: jest.fn(),
	debug: jest.fn(),
	warning: jest.fn(),
	startGroup: jest.fn(),
	endGroup: jest.fn(),
	summary: {
		addHeading: jest.fn().mockReturnThis(),
		addTable: jest.fn().mockReturnThis(),
		write: jest.fn().mockResolvedValue(undefined),
	},
}));

// Test constants
const TEST_CONFIG = {
	REPOSITORY: "company/reviewer-lottery-test",
	PR_NUMBER: 42,
	REF: "refs/pull/feature-branch",
} as const;

const octokit = getOctokit("test-token");

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
			.reply(200, [pullWithHead])
			.persist(); // Allow multiple calls
	};

	const expectReviewerAssignment = (expectation: {
		count?: number;
		shouldInclude?: string[];
		shouldExclude?: string[];
		validCandidates?: string[];
	}) => {
		return nock("https://api.github.com")
			.post(
				`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`,
			)
			.reply(200, (_uri, requestBody) => {
				let body: unknown;
				try {
					body =
						typeof requestBody === "string"
							? JSON.parse(requestBody)
							: requestBody;
				} catch (_error) {
					body = requestBody;
				}
				const { reviewers } = body as { reviewers: string[] };

				// Perform expectations as side effects
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

				if (expectation.validCandidates) {
					reviewers.forEach((reviewer: string) => {
						expect(expectation.validCandidates).toContain(reviewer);
					});
				}

				return { number: TEST_CONFIG.PR_NUMBER };
			});
	};

	const setupExistingReviewers = (existingReviewers: string[] = []) => {
		return nock("https://api.github.com")
			.get(
				`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`,
			)
			.reply(200, {
				users: existingReviewers.map((login) => ({ login })),
				teams: [],
			})
			.persist(); // Allow multiple calls
	};

	return { setupPullRequest, expectReviewerAssignment, setupExistingReviewers };
};

const whenLotteryRuns = async (
	config: {
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
	},
	prInfo?: {
		prNumber: number;
		repository: string;
		ref: string;
		author?: string;
	},
) => {
	await runLottery(
		octokit,
		config,
		prInfo || {
			prNumber: TEST_CONFIG.PR_NUMBER,
			repository: TEST_CONFIG.REPOSITORY,
			ref: TEST_CONFIG.REF,
		},
	);
};

describe("Reviewer Lottery System", () => {
	beforeEach(() => {
		// Ensure nock is clean before each test
		nock.cleanAll();
		jest.clearAllMocks();
	});

	afterEach(() => {
		// Clean up after each test
		nock.cleanAll();
		nock.restore();
		// Ensure no pending interceptors
		if (!nock.isDone()) {
			nock.pendingMocks().forEach((mock) => {
				console.warn("Pending mock:", mock);
			});
		}
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2,
				shouldExclude: ["alice"], // Author should never be assigned as reviewer
				validCandidates: ["bob", "charlie", "diana"], // Available from backend-team
			});

			// When: Alice opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: reviewers are assigned but Alice is excluded
			// Expectations are performed within the mock
		});

		test("sets correct action outputs when reviewers are assigned", async () => {
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2,
				shouldExclude: ["alice"], // Author should never be assigned as reviewer
				validCandidates: ["bob", "charlie", "diana"], // Available from backend-team
			});

			// When: Alice opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules, {
				prNumber: TEST_CONFIG.PR_NUMBER,
				repository: TEST_CONFIG.REPOSITORY,
				ref: TEST_CONFIG.REF,
				author: "alice",
			});

			// Then: correct action outputs are set
			const core = require("@actions/core");
			expect(core.setOutput).toHaveBeenCalledWith("pr-author", "alice");
			expect(core.setOutput).toHaveBeenCalledWith(
				"author-group",
				"backend-team",
			);
			expect(core.setOutput).toHaveBeenCalledWith("existing-reviewers", "");
			expect(core.setOutput).toHaveBeenCalledWith("reviewer-count", "2");
			expect(core.setOutput).toHaveBeenCalledWith(
				"assignment-successful",
				"true",
			);

			// Verify structured logging
			expect(core.startGroup).toHaveBeenCalledWith(
				"🎯 Reviewer Lottery - Starting",
			);
			expect(core.startGroup).toHaveBeenCalledWith("🎲 Selecting reviewers");
			expect(core.startGroup).toHaveBeenCalledWith("📝 Assigning reviewers");
			expect(core.endGroup).toHaveBeenCalledTimes(3);

			// Verify summary is written
			expect(core.summary.addHeading).toHaveBeenCalledWith(
				"🎯 Reviewer Lottery Results",
			);
			expect(core.summary.write).toHaveBeenCalled();
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
			const _reviewerMock = api.expectReviewerAssignment({
				count: 4, // 2 from each team
				shouldExclude: ["eve"], // Author excluded
				validCandidates: ["alice", "bob", "charlie", "diana"], // Available from both teams
			});

			// When: Eve opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: reviewers are selected from both teams without duplicates
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
			const _reviewerMock = api.expectReviewerAssignment({
				count: 1, // Only bob can be assigned
				shouldInclude: ["bob"],
				shouldExclude: ["alice"],
				validCandidates: ["bob"], // Only bob is available
			});

			// When: Alice opens a PR and the lottery runs
			await whenLotteryRuns(configWithRules);

			// Then: only available reviewers are assigned
			// Expectations are performed within the mock
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
				const _pullMock = api.setupPullRequest(scenario.pull);
				const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
				const _reviewerMock = api.expectReviewerAssignment({
					count: 3, // 1 from backend + 2 from frontend
					shouldExclude: ["external-contributor"],
					validCandidates: ["alice", "bob", "charlie", "diana"], // Available from both teams
				});

				// When: external contributor opens PR
				await whenLotteryRuns(configWithRules);

				// Then: default rules are applied
				// Expectations are performed within the mock
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
				const _pullMock = api.setupPullRequest(scenario.pull);
				const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
				const _reviewerMock = api.expectReviewerAssignment({
					count: 3, // 2 from backend + 1 from frontend
					shouldExclude: ["alice"],
					validCandidates: ["bob", "charlie", "diana", "eve"], // Available from both teams
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: group-specific rules are applied
				// Expectations are performed within the mock
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
				const _pullMock = api.setupPullRequest(scenario.pull);
				const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
				const _reviewerMock = api.expectReviewerAssignment({
					count: 3,
					shouldExclude: ["alice"],
					validCandidates: ["bob", "charlie", "diana", "eve", "frank"], // Available from all teams
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: reviewers are selected from all groups
				// Expectations are performed within the mock
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
				const _pullMock = api.setupPullRequest(scenario.pull);
				const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
				const _reviewerMock = api.expectReviewerAssignment({
					count: 3,
					shouldExclude: ["alice"],
					validCandidates: ["bob", "charlie", "diana", "eve", "frank"], // Available from all teams
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: reviewers are selected from backend + non-backend groups
				// Expectations are performed within the mock
			});

			test('supports "!group" keyword for single group exclusion', async () => {
				// Given: configuration using "!group" keyword for single exclusion
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
									"!ops": 2, // 2 from groups excluding ops only
								},
							},
						],
					},
				};

				const api = givenGitHubAPI();
				const _pullMock = api.setupPullRequest(scenario.pull);
				const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
				const _reviewerMock = api.expectReviewerAssignment({
					count: 2,
					shouldExclude: ["alice"],
					validCandidates: ["bob", "charlie", "diana"], // Available from backend and frontend only (ops excluded)
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: reviewers are selected from groups excluding ops
				// Expectations are performed within the mock
			});

			test('supports "!group1,group2" keyword for multiple group exclusion', async () => {
				// Given: configuration using "!group1,group2" keyword for multiple exclusions
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
						{
							name: "security",
							members: ["george", "helen"],
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
									"!ops,security": 2, // 2 from groups excluding ops and security
								},
							},
						],
					},
				};

				const api = givenGitHubAPI();
				const _pullMock = api.setupPullRequest(scenario.pull);
				const _existingReviewersMock = api.setupExistingReviewers(); // Empty existing reviewers
				const _reviewerMock = api.expectReviewerAssignment({
					count: 2,
					shouldExclude: ["alice"],
					validCandidates: ["bob", "charlie", "diana"], // Available from backend and frontend only (ops and security excluded)
				});

				// When: backend team member opens PR
				await whenLotteryRuns(configWithRules);

				// Then: reviewers are selected from groups excluding ops and security
				// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers(["bob"]); // Bob is already assigned
			const _reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should only select 1 more (2 required - 1 existing = 1)
				shouldExclude: ["alice", "bob"], // Exclude author and existing reviewer
				validCandidates: ["charlie", "diana"], // Available from backend-team
			});

			// When: Alice opens a PR with Bob already assigned as reviewer
			await whenLotteryRuns(configWithRules);

			// Then: only 1 additional reviewer is selected
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"bob",
				"charlie",
			]); // 2 already assigned

			// Expect no new reviewer assignment since requirement is already met
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: Alice opens a PR with Bob and Charlie already assigned as reviewers
			await whenLotteryRuns(configWithRules);

			// Then: no additional reviewers are selected
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"bob",
				"diana",
			]); // 1 from each group
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 2 more (1 from each group)
				shouldExclude: ["alice", "bob", "diana"], // Exclude author and existing reviewers
				validCandidates: ["charlie", "eve", "frank"], // Available from both teams
			});

			// When: Alice opens a PR with Bob (backend) and Diana (frontend) already assigned
			await whenLotteryRuns(configWithRules);

			// Then: 1 additional reviewer from each group is selected
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"alice",
				"diana",
			]); // 1 from backend, 1 from frontend
			const _reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should select 1 more from backend (2 required - 1 existing = 1)
				shouldExclude: ["external-contributor", "alice", "diana"], // Exclude author and existing reviewers
				validCandidates: ["bob", "charlie", "eve"], // Available from both teams
			});

			// When: external contributor opens a PR with existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: additional reviewers are selected based on remaining need
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"diana",
				"george",
			]); // 1 from frontend, 1 from ops (requirements already met)

			// Expect no new reviewer assignment since default rule requirements are met
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: Alice (backend member) opens PR, falls back to default rule
			await whenLotteryRuns(configWithRules);

			// Then: no additional reviewers are selected as requirements are met
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"diana", // 1 from frontend
				"frank", // 1 from ops
			]); // 2 existing, need 2 more
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 2 more (4 required - 2 existing = 2)
				shouldExclude: ["alice", "diana", "frank"], // Exclude author and existing reviewers
				validCandidates: ["bob", "charlie", "eve", "george"], // Available from all teams
			});

			// When: Alice opens PR with wildcard selection and existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: additional reviewers are selected to meet total requirement
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"bob", // 1 from backend (requirement met)
				"diana", // 1 from frontend (1 more needed from non-backend)
			]);
			const _reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should select 1 more from non-backend groups
				shouldExclude: ["alice", "bob", "diana"], // Exclude author and existing reviewers
				validCandidates: ["charlie", "eve", "frank", "george"], // Available from all teams
			});

			// When: Alice opens PR with exclusion selection and existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: additional reviewers are selected from non-backend groups only
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"bob", // 1 from backend (need 1 more)
				"external-user", // Not in any group (should be ignored in counting)
			]);
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 1 more from backend + 1 from frontend
				shouldExclude: ["alice", "bob", "external-user"], // Exclude author and all existing reviewers
				validCandidates: ["charlie", "diana", "eve"], // Available from both teams
			});

			// When: Alice opens PR with mix of group members and external reviewers
			await whenLotteryRuns(configWithRules);

			// Then: external reviewers are ignored in group counting
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"bob",
				"charlie",
				"diana", // 3 existing reviewers (more than required 2)
			]);

			// Expect no new reviewer assignment since requirement is already exceeded
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: Alice opens PR with more reviewers than required
			await whenLotteryRuns(configWithRules);

			// Then: no additional reviewers are selected
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);

			// Mock API error for existing reviewers request
			const _existingReviewersErrorMock = nock("https://api.github.com")
				.get(
					`/repos/${TEST_CONFIG.REPOSITORY}/pulls/${TEST_CONFIG.PR_NUMBER}/requested_reviewers`,
				)
				.reply(500, { message: "Internal Server Error" });

			// Should still proceed with normal reviewer selection (treating as no existing reviewers)
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2, // Should select 2 reviewers as if no existing reviewers
				shouldExclude: ["alice"], // Only exclude author
				validCandidates: ["bob", "charlie"], // Available from backend-team
			});

			// When: API error occurs while fetching existing reviewers
			await whenLotteryRuns(configWithRules);

			// Then: system gracefully handles error and proceeds with selection
			// Expectations are performed within the mock
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
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers([
				"charlie", // 1 from ops (ops requirement met)
			]);
			const _reviewerMock = api.expectReviewerAssignment({
				count: 1, // Should select 1 from backend (frontend impossible, ops already satisfied)
				shouldExclude: ["alice", "charlie"], // Exclude author and existing reviewers
				validCandidates: ["bob"], // Available from backend-team only
			});

			// When: Alice opens PR with empty groups in configuration
			await whenLotteryRuns(configWithRules);

			// Then: system handles empty groups gracefully
			// Expectations are performed within the mock
		});
	});

	describe("Error handling and edge cases", () => {
		test("handles missing selection_rules configuration", async () => {
			// Given: configuration without selection_rules
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
				],
			});

			const configWithoutRules = {
				...scenario.config,
				// No selection_rules defined
			};

			const api = givenGitHubAPI();
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers();

			// Expect no reviewer assignment
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: lottery runs without selection_rules
			await whenLotteryRuns(configWithoutRules);

			// Then: no reviewers are selected and no error occurs
		});

		test("handles empty fromClause gracefully", async () => {
			// Given: configuration with empty fromClause
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
				],
			});

			const configWithEmptyFrom = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "backend-team",
							from: {}, // Empty fromClause
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers();

			// Expect no reviewer assignment
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: lottery runs with empty fromClause
			await whenLotteryRuns(configWithEmptyFrom);

			// Then: no reviewers are selected
		});

		test("handles PR not found error", async () => {
			// Given: PR with mismatched ref
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob"],
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					default: {
						from: {
							"backend-team": 1,
						},
					},
				},
			};

			// Mock PR list with different ref
			const pullWithDifferentRef = {
				...scenario.pull,
				head: { ref: "different-ref" },
			};
			nock("https://api.github.com")
				.get("/repos/company/reviewer-lottery-test/pulls")
				.reply(200, [pullWithDifferentRef]);

			// When: lottery runs but PR with matching ref not found
			await whenLotteryRuns(configWithRules);

			// Then: error is handled gracefully
			expect(core.error).toHaveBeenCalled();
			expect(core.setFailed).toHaveBeenCalled();
		});

		test("handles API error when fetching PRs", async () => {
			// Given: API error when fetching PRs
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob"],
					},
				],
			});

			const configWithRules = {
				...scenario.config,
				selection_rules: {
					default: {
						from: {
							"backend-team": 1,
						},
					},
				},
			};

			// Mock API error
			nock("https://api.github.com")
				.get("/repos/company/reviewer-lottery-test/pulls")
				.reply(500, { message: "Internal Server Error" });

			// When: API error occurs
			await whenLotteryRuns(configWithRules);

			// Then: error is handled gracefully
			expect(core.error).toHaveBeenCalled();
			expect(core.setFailed).toHaveBeenCalled();
		});

		test("pickRandom handles duplicate prevention correctly", async () => {
			// Given: small pool requiring duplicate prevention
			const lottery = new Lottery({
				octokit,
				config: {
					groups: [
						{
							name: "small-team",
							usernames: ["alice", "bob", "charlie"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: TEST_CONFIG.REPOSITORY,
					ref: TEST_CONFIG.REF,
				},
			});

			// When: selecting all available candidates
			const result = lottery.pickRandom(
				["alice", "bob", "charlie"],
				3,
				[], // No one to ignore
			);

			// Then: all candidates are selected without duplicates
			expect(result).toHaveLength(3);
			expect(new Set(result).size).toBe(3); // No duplicates
			expect(result.sort()).toEqual(["alice", "bob", "charlie"].sort());
		});

		test("handles author without user login", async () => {
			// Given: PR with null user
			const pull: Pull = {
				number: TEST_CONFIG.PR_NUMBER,
				user: null, // No user
			};

			const config = {
				groups: [
					{
						name: "backend-team",
						usernames: ["alice", "bob"],
					},
				],
				selection_rules: {
					default: {
						from: {
							"backend-team": 2,
						},
					},
				},
			};

			const api = givenGitHubAPI();
			const _pullMock = api.setupPullRequest(pull);
			const _existingReviewersMock = api.setupExistingReviewers();
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2,
				validCandidates: ["alice", "bob"],
			});

			// When: PR has no user
			await whenLotteryRuns(config);

			// Then: reviewers are still selected
		});

		test("handles zero count in fromClause", async () => {
			// Given: configuration with zero count
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

			const configWithZeroCount = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "backend-team",
							from: {
								"backend-team": 0, // Zero count
								"frontend-team": 2,
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers();
			const _reviewerMock = api.expectReviewerAssignment({
				count: 2, // Only from frontend-team
				shouldExclude: ["alice"],
				validCandidates: ["diana", "eve"],
			});

			// When: zero count is specified
			await whenLotteryRuns(configWithZeroCount);

			// Then: zero-count groups are skipped
		});

		test("handles negative count in fromClause", async () => {
			// Given: configuration with negative count
			const scenario = createScenario({
				author: "alice",
				teams: [
					{
						name: "backend-team",
						members: ["alice", "bob", "charlie"],
					},
				],
			});

			const configWithNegativeCount = {
				...scenario.config,
				selection_rules: {
					by_author_group: [
						{
							group: "backend-team",
							from: {
								"backend-team": -1, // Negative count
							},
						},
					],
				},
			};

			const api = givenGitHubAPI();
			const _pullMock = api.setupPullRequest(scenario.pull);
			const _existingReviewersMock = api.setupExistingReviewers();

			// Expect no reviewer assignment
			// No expectReviewerAssignment call since no reviewers should be selected

			// When: negative count is specified
			await whenLotteryRuns(configWithNegativeCount);

			// Then: negative count is treated as zero
		});
	});

	describe("Triangulation tests for reviewer selection logic", () => {
		test("random selection distributes fairly over multiple runs", async () => {
			// Given: scenario requiring random selection
			const lottery = new Lottery({
				octokit,
				config: {
					groups: [
						{
							name: "team",
							usernames: ["alice", "bob", "charlie", "diana"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: TEST_CONFIG.REPOSITORY,
					ref: TEST_CONFIG.REF,
				},
			});

			const selectionCounts: Record<string, number> = {
				alice: 0,
				bob: 0,
				charlie: 0,
				diana: 0,
			};

			// When: running selection multiple times
			for (let i = 0; i < 100; i++) {
				const result = lottery.pickRandom(
					["alice", "bob", "charlie", "diana"],
					1,
					[],
				);
				selectionCounts[result[0]]++;
			}

			// Then: selection is reasonably distributed
			Object.values(selectionCounts).forEach((count) => {
				expect(count).toBeGreaterThan(10); // Each should be selected at least 10 times
				expect(count).toBeLessThan(40); // But not more than 40 times
			});
		});

		test("pickRandom exhausts all candidates before giving up", async () => {
			// Given: request for more reviewers than available
			const lottery = new Lottery({
				octokit,
				config: {
					groups: [
						{
							name: "team",
							usernames: ["alice", "bob"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: TEST_CONFIG.REPOSITORY,
					ref: TEST_CONFIG.REF,
				},
			});

			// When: requesting more than available
			const result = lottery.pickRandom(
				["alice", "bob"],
				5, // Want 5 but only 2 available
				[],
			);

			// Then: returns all available candidates
			expect(result).toHaveLength(2);
			expect(result.sort()).toEqual(["alice", "bob"].sort());
		});
	});
});

// Mock @actions/core for testing error handling
import * as core from "@actions/core";
