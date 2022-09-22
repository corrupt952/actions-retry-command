# retry-command

Retries an Action step on failure.

## Inputs

### `command`

TBD

### `working_directory`

TBD

### `max_attempts`

TBD

### `retry_interval`

TBD

## Output

### `exit_code`

Exit code of the last command executed

### `result`

Output of the last command executed

## Example

### Simple

```yaml
- uses: corrupt952/retry-command@v1
  with:
    command: terraform plan -no-color
    max_attempts: 3
    retry_interval: 10
```

### Retry interval to a random time

```yaml
- uses: corrupt952/retry-command@v1
  with:
    command: terraform plan -no-color
    retry_interval: $((RANDOM % 31))
```

### Set working directory

```yaml
- uses: corrupt952/retry-command@v1
  with:
    command: terraform plan -no-color
    working-directory: path/to
```

### Using output of the last command executed

```yaml
- uses: corrupt952/retry-command@v1
  id: terraform_plan
  continue-on-error: true
  with:
    command: terraform plan -no-color
    max_attempts: 3
- if: steps.terraform_plan.outcome == 'failure'
  run: |
    echo "Exit code: ${{ steps.terraform_plan.outputs.exit_code }}"
    echo "Result: ${{ steps.terraform_plan.outputs.result }}
```
