import { Lottery } from "../../src/lottery";
import type { Logger, ActionOutputs, GitHubService } from "../../src/interfaces";

// Mock implementations for testing business logic
const createMockLogger = (): Logger => ({
	startGroup: jest.fn(),
	endGroup: jest.fn(),
	info: jest.fn(),
	debug: jest.fn(),
	error: jest.fn(),
	warning: jest.fn(),
});

const createMockActionOutputs = (): ActionOutputs => ({
	setOutput: jest.fn(),
	setFailed: jest.fn(),
	addSummary: jest.fn().mockResolvedValue(undefined),
});

const createMockGitHubService = (): GitHubService => ({
	setReviewers: jest.fn().mockResolvedValue({}),
	getExistingReviewers: jest.fn().mockResolvedValue([]),
	getPRAuthor: jest.fn().mockResolvedValue(""),
	findPRByRef: jest.fn().mockResolvedValue(undefined),
});

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

		test("selects random items from pool", () => {
			const items = ["alice", "bob", "charlie", "diana"];
			const result = lottery.pickRandom(items, 2, []);

			expect(result).toHaveLength(2);
			result.forEach((item) => {
				expect(items).toContain(item);
			});
		});

		test("excludes ignored items", () => {
			const items = ["alice", "bob", "charlie", "diana"];
			const ignore = ["alice", "bob"];
			const result = lottery.pickRandom(items, 2, ignore);

			expect(result).toHaveLength(2);
			result.forEach((item) => {
				expect(ignore).not.toContain(item);
			});
		});

		test("returns empty array when no valid candidates", () => {
			const items = ["alice", "bob"];
			const ignore = ["alice", "bob"];
			const result = lottery.pickRandom(items, 2, ignore);

			expect(result).toEqual([]);
		});

		test("returns all available items when n exceeds pool size", () => {
			const items = ["alice", "bob"];
			const result = lottery.pickRandom(items, 5, []);

			expect(result).toHaveLength(2);
			expect(result.sort()).toEqual(["alice", "bob"]);
		});

		test("does not return duplicate items", () => {
			const items = ["alice", "bob", "charlie"];
			const result = lottery.pickRandom(items, 3, []);

			expect(result).toHaveLength(3);
			expect(new Set(result).size).toBe(3);
		});

		test("handles empty items array", () => {
			const result = lottery.pickRandom([], 2, []);

			expect(result).toEqual([]);
		});

		test("handles zero count", () => {
			const items = ["alice", "bob"];
			const result = lottery.pickRandom(items, 0, []);

			expect(result).toEqual([]);
		});
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

		test("returns group name when author is in group", () => {
			expect(lottery.getAuthorGroup("alice")).toBe("backend");
			expect(lottery.getAuthorGroup("bob")).toBe("backend");
			expect(lottery.getAuthorGroup("charlie")).toBe("frontend");
			expect(lottery.getAuthorGroup("diana")).toBe("frontend");
			expect(lottery.getAuthorGroup("eve")).toBe("ops");
		});

		test("returns null when author is not in any group", () => {
			expect(lottery.getAuthorGroup("unknown")).toBeNull();
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

			expect(lotteryWithOverlap.getAuthorGroup("alice")).toBe("backend");
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

			expect(lotteryWithEmptyGroups.getAuthorGroup("alice")).toBeNull();
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
			const result = (lottery as any).resolveGroupSelection("*", null);

			expect(result).toEqual(["backend", "frontend", "ops"]);
		});

		test("returns specific group for group name", () => {
			const result = (lottery as any).resolveGroupSelection("backend", null);

			expect(result).toEqual(["backend"]);
		});

		test("excludes single group with '!' prefix", () => {
			const result = (lottery as any).resolveGroupSelection("!backend", null);

			expect(result).toEqual(["frontend", "ops"]);
		});

		test("excludes multiple groups with '!' prefix and comma separation", () => {
			const result = (lottery as any).resolveGroupSelection("!backend,frontend", null);

			expect(result).toEqual(["ops"]);
		});

		test("handles whitespace in exclusion list", () => {
			const result = (lottery as any).resolveGroupSelection("!backend, frontend", null);

			expect(result).toEqual(["ops"]);
		});

		test("returns empty array when excluding all groups", () => {
			const result = (lottery as any).resolveGroupSelection("!backend,frontend,ops", null);

			expect(result).toEqual([]);
		});

		test("returns empty array for non-existent group", () => {
			const result = (lottery as any).resolveGroupSelection("nonexistent", null);

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
			const result = (lottery as any).getCandidatesFromGroups(["backend"]);

			expect(result).toEqual(["alice", "bob"]);
		});

		test("returns candidates from multiple groups", () => {
			const result = (lottery as any).getCandidatesFromGroups(["backend", "frontend"]);

			expect(result).toEqual(["alice", "bob", "charlie", "diana"]);
		});

		test("returns empty array for non-existent group", () => {
			const result = (lottery as any).getCandidatesFromGroups(["nonexistent"]);

			expect(result).toEqual([]);
		});

		test("handles empty groups array", () => {
			const result = (lottery as any).getCandidatesFromGroups([]);

			expect(result).toEqual([]);
		});

		test("handles mix of existing and non-existing groups", () => {
			const result = (lottery as any).getCandidatesFromGroups(["backend", "nonexistent", "ops"]);

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
			const result = (lottery as any).selectReviewersWithRules("alice", []);

			// Should use backend group rule: 2 from backend + 1 from frontend
			expect(result).toHaveLength(3);
			// Should exclude author
			expect(result).not.toContain("alice");
		});

		test("uses non-group-members rule when author is not in any group", () => {
			const result = (lottery as any).selectReviewersWithRules("external", []);

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

			const result = (lotteryWithoutSpecificRule as any).selectReviewersWithRules("alice", []);

			// Should use default rule: 1 from backend + 1 from frontend
			expect(result).toHaveLength(2);
			expect(result).not.toContain("alice");
		});

		test("considers existing reviewers in selection", () => {
			const existingReviewers = ["bob", "diana"];
			const result = (lottery as any).selectReviewersWithRules("alice", existingReviewers);

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

			const result = (lotteryWithoutRules as any).selectReviewersWithRules("alice", []);

			expect(result).toEqual([]);
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
			const result = (lottery as any).selectFromMultipleGroups(fromClause, "alice", "backend", []);

			expect(result).toHaveLength(3);
			expect(result).not.toContain("alice");
		});

		test("skips groups with zero or negative counts", () => {
			const fromClause = {
				backend: 2,
				frontend: 0,
			};
			const result = (lottery as any).selectFromMultipleGroups(fromClause, "alice", "backend", []);

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
			const result = (lottery as any).selectFromMultipleGroups(fromClause, "alice", "backend", existingReviewers);

			// bob (backend) and diana (frontend) are already reviewers
			// Need 1 more from backend, 0 more from frontend
			expect(result).toHaveLength(1);
			expect(result).toContain("charlie");
		});

		test("handles wildcard selection", () => {
			const fromClause = {
				"*": 3,
			};
			const result = (lottery as any).selectFromMultipleGroups(fromClause, "alice", "backend", []);

			expect(result).toHaveLength(3);
			expect(result).not.toContain("alice");
		});

		test("handles exclusion selection", () => {
			const fromClause = {
				"!backend": 2,
			};
			const result = (lottery as any).selectFromMultipleGroups(fromClause, "alice", "backend", []);

			expect(result).toHaveLength(2);
			expect(result).not.toContain("alice");
			// Should only select from frontend
			result.forEach((reviewer: string) => {
				expect(["diana", "eve"]).toContain(reviewer);
			});
		});
	});
});