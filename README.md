# Reviewer lottery (Github Action)

This is a github action to add automatic reviewer lottery to your pull requests.

Add your configuration on `.github/reviewer-lottery.yml`

```yaml
groups:
  - name: devs # name of the group
    reviewers: 1 # how many reviewers do you want to assign?
    usernames: # github usernames of the reviewers
      - uesteibar
      - tebs
      - rudeayelo
      - marciobarrios

  - name: qas # you can have multiple groups, it will evaluate them separately
    reviewers: 1
    usernames:
      - some_user
      - someoneelse
```

The ideal workflow configuration is:

```yaml
name: "Reviewer lottery"
on:
  pull_request:
    types: [opened, ready_for_review, reopened]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v1
    - uses: uesteibar/reviewer-lottery@v1
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
```


When opening a PR, this github action will assign random reviewers:

![](./img/assignation_example.png)


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
