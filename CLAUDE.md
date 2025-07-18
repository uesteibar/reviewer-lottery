# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Action that automatically assigns reviewers to Pull Requests using a lottery system. The action reads configuration from `.github/reviewer-lottery.yml` and assigns reviewers based on flexible selection rules.

## Directory Structure

```
src/
├── main.ts                   # GitHub Action entry point
├── lottery.ts               # Main lottery logic and orchestration
├── config.ts                # Configuration parsing and validation
├── interfaces.ts            # Service contracts and interfaces
├── actions-service.ts       # GitHub Actions logging service
├── github-service.ts        # GitHub API service implementation
├── config-test.ts           # CLI tool for configuration testing
├── core/
│   └── reviewer-selector.ts # Core reviewer selection logic
└── types/
    └── selection-types.ts   # Selection-specific type definitions

__tests__/
├── unit/
│   └── lottery.test.ts      # Unit tests for lottery logic
├── integration/
│   └── lottery-github-api.test.ts # Integration tests
├── mocks.ts                 # Test mocks and stubs
└── test-helpers.ts          # Test utility functions

examples/
├── sample-config.yml        # Basic configuration example
├── advanced-selection-patterns.yml
├── complex-group-patterns.yml
└── organizational-hierarchy.yml

bin/                         # CLI executables
action.yml                   # GitHub Action definition
tsconfig.json               # TypeScript configuration
tsup.config.ts              # Build configuration
jest.config.js              # Test configuration
biome.json                  # Linting/formatting configuration
```

## Core Architecture

### Main Components

- **src/main.ts**: Entry point that extracts PR information from GitHub Actions context and orchestrates the lottery process
- **src/lottery.ts**: Core lottery logic containing the `Lottery` class that handles reviewer selection and GitHub API interactions
- **src/config.ts**: Configuration parsing and validation, loads YAML config from `.github/reviewer-lottery.yml`
- **src/interfaces.ts**: TypeScript interfaces for all service contracts and data structures
- **src/actions-service.ts**: Service implementations for GitHub Actions logging and outputs
- **src/github-service.ts**: Service implementation for GitHub API interactions
- **src/core/reviewer-selector.ts**: Core reviewer selection logic with sophisticated rule handling
- **src/config-test.ts**: CLI tool for testing configuration files locally

### Key Classes

- **Lottery**: Main class that manages the reviewer selection process
  - Uses dependency injection for all external services
  - Implements complex selection rules (by author group, fallback rules, etc.)
  - Manages exclusion logic (author, existing reviewers, selected reviewers)
  - Provides comprehensive logging and GitHub Action outputs
- **ReviewerSelector**: Core selection logic extracted from Lottery class
  - Handles multiple group membership strategies ("merge" vs "first")
  - Implements special selector patterns (`"*"`, `"!groupname"`)
  - Returns detailed selection results with applied rules and process steps

### Service Layer

- **GitHubServiceImpl**: Handles all GitHub API interactions
  - Get PR information, existing reviewers, and PR authors
  - Set reviewers on pull requests
  - Find PRs by Git reference
- **LoggerImpl**: Wraps GitHub Actions core logging with structured output
- **ActionOutputsImpl**: Manages GitHub Actions outputs and job summaries

### Selection Rules Architecture

The action supports sophisticated selection rules:
- **default**: Fallback rules for any author
- **by_author_group**: Rules specific to authors in particular groups
- **non_group_members**: Rules for authors not in any group
- Special selectors: `"*"` (all groups), `"!groupname"` (exclude group)

## Development Commands

```bash
# Install dependencies
pnpm install

# Type checking without output
pnpm typecheck

# Run tests
pnpm test

# Run single test by pattern
pnpm test -- --testNamePattern="test name"

# Format code
pnpm format

# Check formatting
pnpm format-check

# Lint code
pnpm lint

# Fix linting issues
pnpm lint-fix

# Build distribution bundle (creates dist/index.js)
pnpm pack

# Test configuration locally
npx tsx bin/config-test.js

# Run all checks (typecheck, format, lint, pack, test)
pnpm all
```

## Testing

- Uses Jest with ts-jest for TypeScript support
- Tests are in `__tests__/` directory
- Run single test: `pnpm test -- --testNamePattern="test name"`
- Coverage reports generated in `coverage/` directory

## Code Style

- Uses Biome for formatting and linting
- Tab indentation, double quotes
- Strict TypeScript configuration
- Organized imports enabled

## Configuration

The action expects a YAML configuration file at `.github/reviewer-lottery.yml` with:
- `groups`: Array of team definitions with names and usernames
- `selection_rules`: Complex rules for reviewer assignment based on author group membership
  - `default`: Fallback rules for any author
  - `by_author_group`: Rules specific to authors in particular groups
  - `non_group_members`: Rules for authors not in any group
- `when_author_in_multiple_groups`: Strategy for handling multiple group membership ("merge" or "first")

### Configuration Testing

Use the built-in config tester to validate your configuration:
```bash
npx tsx bin/config-test.js
```

This CLI tool will:
- Load and validate your configuration
- Generate test scenarios based on your groups
- Show detailed selection results for each scenario
- Provide statistics on reviewer distribution

## GitHub Action Integration

- Runs on Node.js 20
- Main entry point: `dist/index.js` (built from TypeScript source)
- Expects `repo-token` input (GitHub token)
- Optional `config` input (defaults to `.github/reviewer-lottery.yml`)
- Optional `pr-author` input (fetched from API if not provided)

## Commit Style

This project uses **Conventional Commits** for commit messages. Follow this format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Common Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, build changes

### Examples
```
feat: add support for excluding bot PRs from lottery
fix: prevent infinite loop in pickRandom when candidates insufficient
test: enhance test coverage and add TDD best practices
docs: update README with new configuration options
refactor: extract reviewer selection logic into separate methods
chore: update dependencies and build configuration
```

## Key Dependencies

- `@actions/core`: GitHub Actions SDK for inputs/outputs/logging
- `@actions/github`: GitHub API client and context handling
- `js-yaml`: YAML parsing for configuration
- `tsup`: Modern TypeScript bundler (replaces deprecated `@vercel/ncc`)

## Build Process

### Development Build
- **TypeScript compilation**: `tsc` compiles to `lib/` directory
- **Target**: ES6 with CommonJS modules for Node.js compatibility

### Distribution Build
- **Bundler**: `tsup` creates single minified `dist/index.js` file
- **Configuration**: `tsup.config.ts`
- **Target**: Node.js 20
- **Features**: Bundled, minified, all dependencies included
