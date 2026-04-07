# actions-retry-command

Retries a shell command on failure with **real-time output streaming**.

Unlike other retry actions that swallow command output during execution, this
action streams stdout and stderr to the Actions log in real time while still
capturing the output for use in subsequent steps.

[Marketplace](https://github.com/marketplace/actions/retry-command)

## Inputs

| Name                 | Required | Default | Description                                            |
| -------------------- | -------- | ------- | ------------------------------------------------------ |
| `command`            | Yes      |         | The command to execute                                 |
| `working_directory`  | No       |         | Working directory for command execution                |
| `max_attempts`       | No       | `5`     | Maximum number of retry attempts                       |
| `retry_interval`     | No       | `5`     | Seconds to wait between retries (supports expressions) |
| `timeout`            | No       |         | Per-attempt timeout in seconds                         |
| `shell`              | No       | `bash`  | Shell to use (`bash`, `sh`)                            |
| `retry_on_exit_code` | No       |         | Comma-separated exit codes that trigger retry          |

## Outputs

| Name        | Description                                              |
| ----------- | -------------------------------------------------------- |
| `exit_code` | Exit code of the last command execution                  |
| `result`    | Combined stdout and stderr of the last command execution |

## Examples

### Basic

```yaml
- uses: corrupt952/actions-retry-command@v2
  with:
    command: terraform plan -no-color
    max_attempts: 3
    retry_interval: 10
```

### With timeout

```yaml
- uses: corrupt952/actions-retry-command@v2
  with:
    command: curl https://example.com/health
    timeout: 30
    max_attempts: 5
    retry_interval: 10
```

> **Note:** The timeout feature uses `Promise.race` internally. If a command
> exceeds the timeout, the action returns exit code 124 but the underlying
> process may continue running until the GitHub Actions runner terminates it.

### Retry only on specific exit codes

```yaml
- uses: corrupt952/actions-retry-command@v2
  with:
    command: ./deploy.sh
    retry_on_exit_code: '1,2'
    max_attempts: 3
```

### Using a different shell

```yaml
- uses: corrupt952/actions-retry-command@v2
  with:
    command: echo "hello from sh"
    shell: sh
```

### Working directory

```yaml
- uses: corrupt952/actions-retry-command@v2
  with:
    command: ls -la
    working_directory: ./build
```

### Using outputs

```yaml
- uses: corrupt952/actions-retry-command@v2
  id: terraform_plan
  continue-on-error: true
  with:
    command: terraform plan -no-color
    max_attempts: 3
- if: steps.terraform_plan.outcome == 'failure'
  run: |
    echo "Exit code: ${{ steps.terraform_plan.outputs.exit_code }}"
    echo "Result: ${{ steps.terraform_plan.outputs.result }}"
```

## retry_interval Expressions

The `retry_interval` input accepts arithmetic expressions with access to
`attempt` (current attempt number) and `max_attempts`. Built-in functions:
`random(n)`, `min(a, b)`, `max(a, b)`, `floor(n)`, `ceil(n)`.

| Strategy            | Expression             | Attempt 1 | Attempt 2 | Attempt 3 |
| ------------------- | ---------------------- | --------- | --------- | --------- |
| Constant            | `5`                    | 5         | 5         | 5         |
| Linear backoff      | `attempt * 5`          | 5         | 10        | 15        |
| Exponential backoff | `2 ^ attempt`          | 2         | 4         | 8         |
| Jitter              | `5 + random(10)`       | 5-14      | 5-14      | 5-14      |
| Capped exponential  | `min(2 ^ attempt, 60)` | 2         | 4         | 8         |

```yaml
- uses: corrupt952/actions-retry-command@v2
  with:
    command: curl https://example.com/health
    max_attempts: 5
    retry_interval: 'min(2 ^ attempt, 60)'
```

## Migration from v1

- Commands now run via `shell -c` in a subprocess. Internal variables like `$i` from v1's retry loop are no longer accessible.
- All inputs except `command` are now optional with sensible defaults.
- New inputs: `timeout`, `shell`, `retry_on_exit_code`.
- `retry_interval` no longer supports bash expressions (e.g., `$((RANDOM % 10))`). Use the built-in expression syntax instead (e.g., `5 + random(10)`).
- Output is now streamed in real time during execution.
