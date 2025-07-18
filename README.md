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

## Testing Your Configuration Locally

```bash
npx tsx fan-k-tamura/reviewer-lottery/config-test
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

The configuration uses `selection_rules` to provide maximum flexibility for reviewer assignment.

#### Selection Rules Overview

The action supports three types of selection rules:
- **`default`**: Fallback rules for any author
- **`by_author_group`**: Rules specific to authors in particular groups
- **`non_group_members`**: Rules for authors not in any group

#### Complete Configuration Example

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

#### Special Keywords

- **`"*"`** - Select from all groups
- **`"!groupname"`** - Select from all groups except the specified one
- **`"!group1,group2"`** - Select from all groups except the specified ones (comma-separated)

#### Priority Rules

When assigning reviewers, the following priority is used:

1. **For authors in a group**: Looks for matching rule in `by_author_group`, falls back to `default`
2. **For authors not in any group**: Uses `non_group_members` if defined, falls back to `default`
3. **No reviewers assigned**: If no `from` clause is found or is empty

#### Multiple Group Membership

**The Problem**: When a user belongs to multiple groups, it's unclear which group's selection rules should apply.

**The Solution**: Use the `when_author_in_multiple_groups` configuration option to control this behavior.

**Configuration** (root level, same as `groups` and `selection_rules`):
```yaml
when_author_in_multiple_groups: merge  # or "first" (default: "merge")
```

**Available Strategies**:
- **`merge`** (default): Combines all applicable group rules using maximum values
- **`first`**: Uses only the first group's rule (based on group definition order)

**Complete Example**:
```yaml
# Root-level configuration
when_author_in_multiple_groups: merge

groups:
  - name: backend        # alice is in backend (defined first)
    usernames: [alice, bob, charlie]
  - name: frontend       # alice is also in frontend
    usernames: [alice, diana, eve]
  - name: ops
    usernames: [frank, grace]

selection_rules:
  by_author_group:
    - group: backend
      from:
        backend: 1     # backend rule: 1 backend + 2 ops
        ops: 2

    - group: frontend
      from:
        backend: 2     # frontend rule: 2 backend + 1 ops
        ops: 1
```

**Behavior Comparison**:

When **alice** (member of both `backend` and `frontend`) creates a PR:

| Strategy | Rule Applied | Reviewers Assigned | Total |
|----------|-------------|-------------------|-------|
| `merge` | backend: max(1,2)=2, ops: max(2,1)=2 | 2 from backend + 2 from ops | 4 |
| `first` | backend: 1, ops: 2 (ignores frontend rule) | 1 from backend + 2 from ops | 3 |

**When to Use Each Strategy**:
- **`merge`**: When you want comprehensive review coverage (more reviewers)
- **`first`**: When you want predictable, minimal review assignment

#### When No Reviewers Are Added

Reviewers will **not** be added in the following cases:

1. **Empty or missing `from` clause**: When a selection rule exists but has no `from` entries
   ```yaml
   - group: backend
     # No 'from' clause - no reviewers will be assigned
   ```

2. **No matching rules**: When no selection rule matches the PR author
   ```yaml
   selection_rules:
     by_author_group:
       - group: frontend
         from:
           frontend: 1
   # If PR author is from 'backend' group and no default rule exists, no reviewers are assigned
   ```

3. **Insufficient candidates**: When there aren't enough eligible reviewers after exclusions
   ```yaml
   - group: solo-team
     from:
       solo-team: 2  # If solo-team only has 1 member (the author), no reviewers can be assigned
   ```

4. **All candidates excluded**: When all potential reviewers are excluded (author, existing reviewers, etc.)

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
