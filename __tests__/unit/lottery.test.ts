import { Lottery } from "../../src/lottery";

import {
	createMockActionOutputs,
	createMockGitHubService,
	createMockLogger,
} from "../test-helpers";

describe("Lottery Business Logic", () => {
	describe("pickRandom", () => {
		let lottery: Lottery;

		beforeEach(() => {
			lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});
		});

		interface PickRandomTestCase {
			name: string;
			items: string[];
			count: number;
			ignore: string[];
			expectedLength: number;
			validator?: (result: string[], items: string[], ignore: string[]) => void;
		}

		const pickRandomTestCases: PickRandomTestCase[] = [
			{
				name: "selects random items from pool",
				items: ["alice", "bob", "charlie", "diana"],
				count: 2,
				ignore: [],
				expectedLength: 2,
				validator: (result, items) => {
					result.forEach((item) => {
						expect(items).toContain(item);
					});
				},
			},
			{
				name: "excludes ignored items",
				items: ["alice", "bob", "charlie", "diana"],
				count: 2,
				ignore: ["alice", "bob"],
				expectedLength: 2,
				validator: (result, _, ignore) => {
					result.forEach((item) => {
						expect(ignore).not.toContain(item);
					});
				},
			},
			{
				name: "returns empty array when no valid candidates",
				items: ["alice", "bob"],
				count: 2,
				ignore: ["alice", "bob"],
				expectedLength: 0,
			},
			{
				name: "returns all available items when n exceeds pool size",
				items: ["alice", "bob"],
				count: 5,
				ignore: [],
				expectedLength: 2,
				validator: (result) => {
					expect(result.sort()).toEqual(["alice", "bob"]);
				},
			},
			{
				name: "does not return duplicate items",
				items: ["alice", "bob", "charlie"],
				count: 3,
				ignore: [],
				expectedLength: 3,
				validator: (result) => {
					expect(new Set(result).size).toBe(3);
				},
			},
			{
				name: "handles empty items array",
				items: [],
				count: 2,
				ignore: [],
				expectedLength: 0,
			},
			{
				name: "handles zero count",
				items: ["alice", "bob"],
				count: 0,
				ignore: [],
				expectedLength: 0,
			},
		];

		pickRandomTestCases.forEach(
			({ name, items, count, ignore, expectedLength, validator }) => {
				test(name, () => {
					const result = lottery.reviewerSelectorForTesting.pickRandom(
						items,
						count,
						ignore,
					);

					expect(result).toHaveLength(expectedLength);
					if (validator) {
						validator(result, items, ignore);
					}
				});
			},
		);
	});

	describe("getAuthorGroup", () => {
		let lottery: Lottery;

		beforeEach(() => {
			lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
						{
							name: "frontend",
							usernames: ["charlie", "diana"],
						},
						{
							name: "ops",
							usernames: ["eve"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});
		});

		interface GetAuthorGroupTestCase {
			name: string;
			author: string;
			expected: string | null;
		}

		const getAuthorGroupTestCases: GetAuthorGroupTestCase[] = [
			{
				name: "returns backend group for alice",
				author: "alice",
				expected: "backend",
			},
			{
				name: "returns backend group for bob",
				author: "bob",
				expected: "backend",
			},
			{
				name: "returns frontend group for charlie",
				author: "charlie",
				expected: "frontend",
			},
			{
				name: "returns frontend group for diana",
				author: "diana",
				expected: "frontend",
			},
			{ name: "returns ops group for eve", author: "eve", expected: "ops" },
			{
				name: "returns null for unknown author",
				author: "unknown",
				expected: null,
			},
		];

		getAuthorGroupTestCases.forEach(({ name, author, expected }) => {
			test(name, () => {
				expect(lottery.reviewerSelectorForTesting.getAuthorGroup(author)).toBe(
					expected,
				);
			});
		});

		test("returns first group if user is in multiple groups", () => {
			const lotteryWithOverlap = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
						{
							name: "fullstack",
							usernames: ["alice", "charlie"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			expect(
				lotteryWithOverlap.reviewerSelectorForTesting.getAuthorGroup("alice"),
			).toBe("backend");
		});

		test("returns all groups if user is in multiple groups", () => {
			const lotteryWithOverlap = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
						{
							name: "fullstack",
							usernames: ["alice", "charlie"],
						},
						{
							name: "devops",
							usernames: ["alice", "david"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			expect(
				lotteryWithOverlap.reviewerSelectorForTesting.getAuthorGroups("alice"),
			).toEqual(["backend", "fullstack", "devops"]);
		});

		test("handles empty groups", () => {
			const lotteryWithEmptyGroups = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			expect(
				lotteryWithEmptyGroups.reviewerSelectorForTesting.getAuthorGroup(
					"alice",
				),
			).toBeNull();
		});
	});

	describe("getOwnerAndRepo", () => {
		test("parses repository string correctly", () => {
			const lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [],
					selection_rules: {},
				},
				env: {
					repository: "owner/repo-name",
					ref: "refs/pull/1/head",
				},
			});

			const result = lottery.getOwnerAndRepo();

			expect(result).toEqual({
				owner: "owner",
				repo: "repo-name",
			});
		});

		test("handles repository with complex names", () => {
			const lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [],
					selection_rules: {},
				},
				env: {
					repository: "my-org/my-awesome-repo",
					ref: "refs/pull/1/head",
				},
			});

			const result = lottery.getOwnerAndRepo();

			expect(result).toEqual({
				owner: "my-org",
				repo: "my-awesome-repo",
			});
		});
	});

	describe("resolveGroupSelection", () => {
		let lottery: Lottery;

		beforeEach(() => {
			lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
						{
							name: "frontend",
							usernames: ["charlie", "diana"],
						},
						{
							name: "ops",
							usernames: ["eve"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});
		});

		test("returns all groups for wildcard '*'", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"*",
				null,
			);

			expect(result).toEqual(["backend", "frontend", "ops"]);
		});

		test("returns specific group for group name", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"backend",
				null,
			);

			expect(result).toEqual(["backend"]);
		});

		test("excludes single group with '!' prefix", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"!backend",
				null,
			);

			expect(result).toEqual(["frontend", "ops"]);
		});

		test("excludes multiple groups with '!' prefix and comma separation", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"!backend,frontend",
				null,
			);

			expect(result).toEqual(["ops"]);
		});

		test("handles whitespace in exclusion list", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"!backend, frontend",
				null,
			);

			expect(result).toEqual(["ops"]);
		});

		test("returns empty array when excluding all groups", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"!backend,frontend,ops",
				null,
			);

			expect(result).toEqual([]);
		});

		test("returns empty array for non-existent group", () => {
			const result = lottery.reviewerSelectorForTesting.resolveGroupSelection(
				"nonexistent",
				null,
			);

			expect(result).toEqual(["nonexistent"]);
		});
	});

	describe("getCandidatesFromGroups", () => {
		let lottery: Lottery;

		beforeEach(() => {
			lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
						{
							name: "frontend",
							usernames: ["charlie", "diana"],
						},
						{
							name: "ops",
							usernames: ["eve"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});
		});

		test("returns candidates from single group", () => {
			const result = lottery.reviewerSelectorForTesting.getCandidatesFromGroups(
				["backend"],
			);

			expect(result).toEqual(["alice", "bob"]);
		});

		test("returns candidates from multiple groups", () => {
			const result = lottery.reviewerSelectorForTesting.getCandidatesFromGroups(
				["backend", "frontend"],
			);

			expect(result).toEqual(["alice", "bob", "charlie", "diana"]);
		});

		test("returns empty array for non-existent group", () => {
			const result = lottery.reviewerSelectorForTesting.getCandidatesFromGroups(
				["nonexistent"],
			);

			expect(result).toEqual([]);
		});

		test("handles empty groups array", () => {
			const result = lottery.reviewerSelectorForTesting.getCandidatesFromGroups(
				[],
			);

			expect(result).toEqual([]);
		});

		test("handles mix of existing and non-existing groups", () => {
			const result = lottery.reviewerSelectorForTesting.getCandidatesFromGroups(
				["backend", "nonexistent", "ops"],
			);

			expect(result).toEqual(["alice", "bob", "eve"]);
		});
	});

	describe("selectReviewersWithRules", () => {
		let lottery: Lottery;

		beforeEach(() => {
			lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob", "charlie"],
						},
						{
							name: "frontend",
							usernames: ["diana", "eve"],
						},
					],
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
									backend: 2,
									frontend: 1,
								},
							},
						],
						non_group_members: {
							from: {
								backend: 1,
								frontend: 2,
							},
						},
					},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});
		});

		test("uses group-specific rules when author is in group", () => {
			const result =
				lottery.reviewerSelectorForTesting.selectReviewersWithRules(
					"alice",
					[],
				);

			// Should use backend group rule: 2 from backend + 1 from frontend
			expect(result).toHaveLength(3);
			// Should exclude author
			expect(result).not.toContain("alice");
		});

		test("uses non-group-members rule when author is not in any group", () => {
			const result =
				lottery.reviewerSelectorForTesting.selectReviewersWithRules(
					"external",
					[],
				);

			// Should use non_group_members rule: 1 from backend + 2 from frontend
			expect(result).toHaveLength(3);
			// Should exclude author
			expect(result).not.toContain("external");
		});

		test("falls back to default rule when no specific rule found", () => {
			const lotteryWithoutSpecificRule = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
						{
							name: "frontend",
							usernames: ["charlie", "diana"],
						},
					],
					selection_rules: {
						default: {
							from: {
								backend: 1,
								frontend: 1,
							},
						},
					},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			const result =
				lotteryWithoutSpecificRule.reviewerSelectorForTesting.selectReviewersWithRules(
					"alice",
					[],
				);

			// Should use default rule: 1 from backend + 1 from frontend
			expect(result).toHaveLength(2);
			expect(result).not.toContain("alice");
		});

		test("considers existing reviewers in selection", () => {
			const existingReviewers = ["bob", "diana"];
			const result =
				lottery.reviewerSelectorForTesting.selectReviewersWithRules(
					"alice",
					existingReviewers,
				);

			// Should use backend group rule: 2 from backend + 1 from frontend
			// But bob (backend) and diana (frontend) are already reviewers
			// So should select 1 more from backend (charlie), 0 more from frontend
			expect(result).toHaveLength(1);
			expect(result).toContain("charlie");
			expect(result).not.toContain("alice");
			expect(result).not.toContain("bob");
			expect(result).not.toContain("diana");
		});

		test("returns empty array when no rules configured", () => {
			const lotteryWithoutRules = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			const result =
				lotteryWithoutRules.reviewerSelectorForTesting.selectReviewersWithRules(
					"alice",
					[],
				);

			expect(result).toEqual([]);
		});

		test("merges rules when author is in multiple groups", () => {
			const lotteryWithMultipleGroups = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "frontend",
							usernames: ["alice", "bob"],
						},
						{
							name: "backend",
							usernames: ["charlie", "diana"],
						},
						{
							name: "devops",
							usernames: ["alice", "eve"],
						},
					],
					selection_rules: {
						default: {
							from: { "*": 1 },
						},
						by_author_group: [
							{
								group: "frontend",
								from: { backend: 2, devops: 1 },
							},
							{
								group: "devops",
								from: { frontend: 1, backend: 1 },
							},
						],
					},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			const result =
				lotteryWithMultipleGroups.reviewerSelectorForTesting.selectReviewers(
					"alice",
				);

			// alice is in both frontend and devops groups
			// frontend rule: backend(2) + devops(1)
			// devops rule: frontend(1) + backend(1)
			// merged rule: backend(max(2,1)=2) + devops(max(1,0)=1) + frontend(max(0,1)=1)
			expect(result.appliedRule?.type).toBe("merged_groups");
			expect(result.appliedRule?.mergedFromGroups).toEqual([
				"frontend",
				"devops",
			]);
			expect(result.appliedRule?.rule).toEqual({
				backend: 2,
				devops: 1,
				frontend: 1,
			});
			expect(result.selectedReviewers).toHaveLength(4); // 2 backend + 1 devops + 1 frontend
			expect(result.selectedReviewers).not.toContain("alice");
		});

		test("uses default rule when no group-specific rules exist for merged groups", () => {
			const lotteryWithDefaultFallback = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "frontend",
							usernames: ["alice", "bob"],
						},
						{
							name: "backend",
							usernames: ["charlie", "diana"],
						},
						{
							name: "devops",
							usernames: ["alice", "eve"],
						},
					],
					selection_rules: {
						default: {
							from: { "*": 1 },
						},
					},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});

			const result =
				lotteryWithDefaultFallback.reviewerSelectorForTesting.selectReviewers(
					"alice",
				);

			// alice is in both frontend and devops groups
			// No group-specific rules, so both groups use default rule
			// merged rule: *(max(1,1)=1)
			expect(result.appliedRule?.type).toBe("merged_groups");
			expect(result.appliedRule?.mergedFromGroups).toEqual([
				"frontend",
				"devops",
			]);
			expect(result.appliedRule?.rule).toEqual({ "*": 1 });
			expect(result.selectedReviewers).toHaveLength(1);
			expect(result.selectedReviewers).not.toContain("alice");
		});
	});

	describe("selectFromMultipleGroups", () => {
		let lottery: Lottery;

		beforeEach(() => {
			lottery = new Lottery({
				logger: createMockLogger(),
				actionOutputs: createMockActionOutputs(),
				githubService: createMockGitHubService(),
				config: {
					groups: [
						{
							name: "backend",
							usernames: ["alice", "bob", "charlie"],
						},
						{
							name: "frontend",
							usernames: ["diana", "eve"],
						},
					],
					selection_rules: {},
				},
				env: {
					repository: "test/repo",
					ref: "refs/pull/1/head",
				},
			});
		});

		test("selects from multiple groups according to counts", () => {
			const fromClause = {
				backend: 2,
				frontend: 1,
			};
			const result =
				lottery.reviewerSelectorForTesting.selectFromMultipleGroups(
					fromClause,
					"alice",
					"backend",
					[],
				);

			expect(result).toHaveLength(3);
			expect(result).not.toContain("alice");
		});

		test("skips groups with zero or negative counts", () => {
			const fromClause = {
				backend: 2,
				frontend: 0,
			};
			const result =
				lottery.reviewerSelectorForTesting.selectFromMultipleGroups(
					fromClause,
					"alice",
					"backend",
					[],
				);

			expect(result).toHaveLength(2);
			expect(result).not.toContain("alice");
			// Should only select from backend
			result.forEach((reviewer: string) => {
				expect(["bob", "charlie"]).toContain(reviewer);
			});
		});

		test("considers existing reviewers when calculating remaining needed", () => {
			const fromClause = {
				backend: 2,
				frontend: 1,
			};
			const existingReviewers = ["bob", "diana"];
			const result =
				lottery.reviewerSelectorForTesting.selectFromMultipleGroups(
					fromClause,
					"alice",
					"backend",
					existingReviewers,
				);

			// bob (backend) and diana (frontend) are already reviewers
			// Need 1 more from backend, 0 more from frontend
			expect(result).toHaveLength(1);
			expect(result).toContain("charlie");
		});

		test("handles wildcard selection", () => {
			const fromClause = {
				"*": 3,
			};
			const result =
				lottery.reviewerSelectorForTesting.selectFromMultipleGroups(
					fromClause,
					"alice",
					"backend",
					[],
				);

			expect(result).toHaveLength(3);
			expect(result).not.toContain("alice");
		});

		test("handles exclusion selection", () => {
			const fromClause = {
				"!backend": 2,
			};
			const result =
				lottery.reviewerSelectorForTesting.selectFromMultipleGroups(
					fromClause,
					"alice",
					"backend",
					[],
				);

			expect(result).toHaveLength(2);
			expect(result).not.toContain("alice");
			// Should only select from frontend
			result.forEach((reviewer: string) => {
				expect(["diana", "eve"]).toContain(reviewer);
			});
		});
	});
});
