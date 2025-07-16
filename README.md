# Reviewer lottery (Github Action)

This is a github action to add automatic reviewer lottery to your pull requests.

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `repo-token` | GitHub token (required) | |
| `config` | Path to configuration file | `.github/reviewer-lottery.yml` |

## Quick Start

1. Create `.github/reviewer-lottery.yml` with a simple configuration:

```yaml
groups:
  - name: team
    usernames:
      - alice
      - bob
      - charlie
      - diana

selection_rules:
  default:
    from:
      team: 2  # Always assign 2 reviewers from the team
```

2. Add the workflow `.github/workflows/reviewer-lottery.yml`:

```yaml
name: "Reviewer lottery"
on:
  pull_request_target:
    types: [opened, ready_for_review, reopened]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: fan-k-tamura/reviewer-lottery@v4
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
        # config: 'path/to/your/config.yml'  # Optional: custom config file path
```

## How It Works

### Basic Behavior
- **New PR**: Assigns reviewers according to your selection rules
- **Existing reviewers**: Respects already assigned reviewers and only adds additional ones if needed
- **Author exclusion**: Never assigns the PR author as a reviewer
- **Group member exclusion**: Excludes users already selected in the same lottery run

### Examples

#### Scenario 1: No existing reviewers
```yaml
# Your config requests 2 backend reviewers
selection_rules:
  default:
    from:
      backend: 2
```
**Result**: Assigns 2 random reviewers from the backend team

#### Scenario 2: Some reviewers already assigned
```yaml
# Your config requests 2 backend reviewers
# But alice from backend is already assigned
selection_rules:
  default:
    from:
      backend: 2
```
**Result**: Assigns 1 additional reviewer from backend (total = 2)

#### Scenario 3: Configuration error
```yaml
# Typo in group name
selection_rules:
  default:
    from:
      backend: 2  # Should be 'backend'
```
**Result**: Action fails with clear error message about unknown group

## FAQ

**Why would I want to assign random reviewers?**

Code reviews are not only a great tool to improve code quality, but also to spread
shared code ownership and share knowledge. When developers are frequently reviewing
changes in the codebase, it's easier to stay up to date with the latest conventions,
patterns and decisions.

Plus, you always learn something new seeing how other people solve problems!


**Why adding users in the config file directly and not using a github team?**

This way, you can add and remove yourself from the lottery easily in case you go on vacation,
are not working on this repo for some time, etc.

Reviewing code is good and fun, but we want to be able to disconnect from time to time! :palm_tree: :sunny:

## Configuration Examples

### Advanced Configuration

The configuration uses `selection_rules` to provide maximum flexibility for reviewer assignment:

```yaml
groups:
  - name: backend
    usernames:
      - alice
      - bob
      - charlie
  - name: frontend
    usernames:
      - diana
      - eve
  - name: ops
    usernames:
      - frank
      - grace

selection_rules:
  # Default rules for authors not in any group or when no group-specific rule exists
  default:
    from:
      backend: 1      # 1 reviewer from backend team
      frontend: 2     # 2 reviewers from frontend team

  # Rules for authors who are not members of any group
  non_group_members:
    from:
      backend: 1      # 1 reviewer from backend team
      ops: 1          # 1 reviewer from ops team

  # Group-specific rules based on PR author's group membership
  by_author_group:
    - group: backend
      from:
        backend: 2    # 2 reviewers from same team
        frontend: 1   # 1 reviewer from frontend team

    - group: frontend
      from:
        "*": 2        # 2 reviewers from any group

    - group: ops
      from:
        ops: 2        # 2 reviewers from ops team
        "!ops": 1     # 1 reviewer from any team except ops
```

#### Priority Rules

When assigning reviewers, the following priority is used:

1. **For authors in a group**: Looks for matching rule in `by_author_group`, falls back to `default`
2. **For authors not in any group**: Uses `non_group_members` if defined, falls back to `default`
3. **No reviewers assigned**: If no `from` clause is found or is empty

#### Special Keywords

- **`"*"`** - Select from all groups
- **`"!groupname"`** - Select from all groups except the specified one
- **`"!group1,group2"`** - Select from all groups except the specified ones (comma-separated)

#### Examples

```yaml
# Example 1: Team members get internal + external review
- group: backend
  from:
    backend: 2      # 2 from same team
    frontend: 1     # 1 from frontend team

# Example 2: All groups participate
- group: frontend
  from:
    "*": 3          # 3 reviewers from any group

# Example 3: Exclude specific groups
- group: ops
  from:
    ops: 1          # 1 from ops team
    "!ops": 2       # 2 from any other team

# Example 4: Exclude multiple specific groups
- group: backend
  from:
    backend: 1              # 1 from backend team
    "!ops,security": 2      # 2 from any team except ops and security
```

### Excluding Bot PRs

You can exclude PRs created by bots (like Dependabot, Renovate, etc.) by adding conditions to your GitHub Actions workflow:

```yaml
name: "Reviewer lottery"
on:
  pull_request_target:
    types: [opened, ready_for_review, reopened]

jobs:
  test:
    runs-on: ubuntu-latest
    # Skip if PR is created by bots
    if: |
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      github.event.pull_request.user.login != 'renovate[bot]' &&
      github.event.pull_request.user.login != 'github-actions[bot]' &&
      !contains(github.event.pull_request.user.login, '[bot]')

    steps:
    - uses: actions/checkout@v4
    - uses: fan-k-tamura/reviewer-lottery@v4
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
```

This approach allows you to control which PRs trigger the reviewer lottery without modifying the lottery configuration itself.

### Custom Configuration File Path

By default, the action looks for configuration at `.github/reviewer-lottery.yml`. You can specify a custom path using the `config` input:

```yaml
- uses: fan-k-tamura/reviewer-lottery@v4
  with:
    repo-token: ${{ secrets.GITHUB_TOKEN }}
    config: 'custom-path/reviewer-config.yml'
```

This allows you to:
- Store configuration in a different location
- Use different configuration files for different workflows
- Keep configuration files organized in subdirectories
