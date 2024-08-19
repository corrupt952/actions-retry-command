# retry-command

Retries an Action step on failure.  
This action is unique compared to other actions in that it is possible to obtain the results of retries.

[Marketplace](https://github.com/marketplace/actions/retry-command)

## Inputs

### `command`

**Required**

The command to run.

### `working_directory`

**Required**

The directory in which to execute the command.

### `max_attempts`

**Required**

The maximum number of times to attempt the command.  
Default is 5.

### `retry_interval`

**Required**

The time to wait between retry attempts, in seconds. Default is 5.  
You can also write `$((RANDOM % 31))` to make it a random value.

## Output

### `exit_code`

Exit code of the last command executed

### `result`

Output of the last command executed

## Example

### Simple

```yaml
- uses: corrupt952/actions-retry-command@v1
  with:
    command: terraform plan -no-color
    max_attempts: 3
    retry_interval: 10
```

### Retry interval to a random time

```yaml
- uses: corrupt952/actions-retry-command@v1
  with:
    command: terraform plan -no-color
    retry_interval: $((RANDOM % 31))
```

### Set working directory

```yaml
- uses: corrupt952/actions-retry-command@v1
  with:
    command: terraform plan -no-color
    working-directory: path/to
```

### Using output of the last command executed

```yaml
- uses: corrupt952/actions-retry-command@v1
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
