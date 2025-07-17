import type { Logger, ActionOutputs, GitHubService } from "../src/interfaces";

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