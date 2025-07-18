import type { Config } from "../src/config";
import type { ActionOutputs, GitHubService, Logger } from "../src/interfaces";
import { Lottery } from "../src/lottery";

// Mock implementations for testing
export const createMockLogger = (): Logger => ({
	startGroup: jest.fn(),
	endGroup: jest.fn(),
	info: jest.fn(),
	debug: jest.fn(),
	error: jest.fn(),
	warning: jest.fn(),
});

export const createMockActionOutputs = (): ActionOutputs => ({
	setOutput: jest.fn(),
	setFailed: jest.fn(),
	addSummary: jest.fn().mockResolvedValue(undefined),
});

export const createMockGitHubService = (): GitHubService => ({
	setReviewers: jest.fn().mockResolvedValue({}),
	getExistingReviewers: jest.fn().mockResolvedValue([]),
	getPRAuthor: jest.fn().mockResolvedValue(""),
	findPRByRef: jest.fn().mockResolvedValue(undefined),
});

// Test constants
export const TEST_CONFIG = {
	REPOSITORY: "company/reviewer-lottery-test",
	PR_NUMBER: 42,
	REF: "refs/pull/feature-branch",
} as const;

// Test data builders
export interface TestScenario {
	author: string;
	teams: Array<{
		name: string;
		members: string[];
	}>;
	existingReviewers?: string[];
}

export const createTestConfig = (scenario: TestScenario): Config => ({
	groups: scenario.teams.map((team) => ({
		name: team.name,
		usernames: team.members,
	})),
	selection_rules: {},
});

export const createLotteryWithScenario = (
	scenario: TestScenario,
	selectionRules?: Config["selection_rules"],
): Lottery => {
	return new Lottery({
		logger: createMockLogger(),
		actionOutputs: createMockActionOutputs(),
		githubService: createMockGitHubService(),
		config: {
			groups: scenario.teams.map((team) => ({
				name: team.name,
				usernames: team.members,
			})),
			selection_rules: selectionRules || {},
		},
		env: {
			repository: TEST_CONFIG.REPOSITORY,
			ref: TEST_CONFIG.REF,
		},
	});
};

// Data-driven test utilities
export interface DataDrivenTestCase<T, R> {
	name: string;
	input: T;
	expected: R;
}

export const runDataDrivenTests = <T, R>(
	testCases: DataDrivenTestCase<T, R>[],
	testFunction: (input: T) => R,
	matcher: (actual: R, expected: R) => void = (actual, expected) =>
		expect(actual).toEqual(expected),
) => {
	testCases.forEach(({ name, input, expected }) => {
		test(name, () => {
			const result = testFunction(input);
			matcher(result, expected);
		});
	});
};
