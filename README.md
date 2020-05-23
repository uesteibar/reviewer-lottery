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
name: "test-lottery"
on:
  pull_request:
    types: [opened, ready_to_review, reopened]

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
