# Retry Command Action - Functional Requirements

## Overview
This document specifies the exact behavior of the retry-command action based on the current bash implementation.

## Input Parameters

| Parameter | Required | Default | Type | Description |
|-----------|----------|---------|------|-------------|
| `command` | Yes | - | string | Shell command to execute |
| `working_directory` | Yes | - | string | Directory where command should run |
| `max_attempts` | Yes | 5 | integer | Maximum number of retry attempts |
| `retry_interval` | Yes | 5 | integer/expression | Seconds to wait between retries |

## Output Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `exit_code` | string | Exit code of the last executed command |
| `result` | string | Combined stdout/stderr output of the last executed command |

## Behavioral Specification

### Retry Loop Logic

1. **Attempt Counter**: Starts at 1, increments up to `max_attempts`
2. **Logging**: Each attempt logs:
   ```
   Attempts: <attempt_number>
   Exit code: <exit_code>
   Result: <command_output>
   ```

3. **Command Execution**:
   - Execute the command in the specified `working_directory`
   - Capture both stdout and stderr (merged)
   - Capture exit code

4. **Success Condition**:
   - Command exits with code 0
   - OR reached `max_attempts` (final attempt, regardless of exit code)

5. **On Success Condition Met**:
   - Write `result` to `GITHUB_OUTPUT` (multiline format)
   - Write `exit_code` to `GITHUB_OUTPUT`
   - Exit with the captured exit code

6. **On Failure (not max attempts yet)**:
   - Log: `sleep: <retry_interval>`
   - Sleep for `retry_interval` seconds
   - Continue to next attempt

### Edge Cases & Special Behaviors

1. **Multiline Output**:
   - Must preserve newlines and special characters
   - Output written using heredoc format (`<<EOS ... EOS`)

2. **Exit Code Handling**:
   - Exit code is captured immediately after command execution
   - Final exit code of the action matches the command's exit code

3. **Retry Interval**:
   - Can be static number (e.g., `5`)
   - Can be bash expression (e.g., `$((RANDOM % 31))`)
   - Evaluated as-is by bash

4. **Working Directory**:
   - Set before command execution
   - Applies to all retry attempts

5. **stdout/stderr Merging**:
   - Both streams captured together with `2>&1`
   - Order preserved as output occurs

## Test Cases (from existing tests)

### Test 1: Output Result on Success
```yaml
Input:
  command: echo "hello"
  retry_interval: 1

Expected:
  outputs.result: "hello"
```

### Test 2: Outcome is Success
```yaml
Input:
  command: echo "hello"
  retry_interval: 1

Expected:
  outcome: "success"
```

### Test 3: Output Result on Error (After All Retries)
```yaml
Input:
  command: echo "count $i" && exit 1
  retry_interval: 1
  max_attempts: 3

Expected:
  outputs.result: "count 3"  # Last attempt (i=3)
```

### Test 4: Outcome is Failure on Error
```yaml
Input:
  command: echo "count $i" && exit 1
  retry_interval: 1
  max_attempts: 3

Expected:
  outcome: "failure"
```

### Test 5: Exit Code Captured on Success
```yaml
Input:
  command: exit 0
  retry_interval: 1

Expected:
  outputs.exit_code: "0"
```

### Test 6: Exit Code Captured on Error
```yaml
Input:
  command: exit 255
  retry_interval: 1

Expected:
  outputs.exit_code: "255"
```

### Test 7: Multiline Output Preservation
```yaml
Input:
  command: echo -e "hello\nworld\ngithub"
  retry_interval: 1

Expected:
  outputs.result: "hello\nworld\ngithub"
```

### Test 8: Retry Behavior (TODO - Not Implemented)
```yaml
# Should verify:
# - Command actually retries on failure
# - Retry interval is respected
# - Logs show correct attempt numbers
```

## Additional Test Cases Needed

### Test 9: Command Succeeds on Retry
```yaml
Input:
  command: # Fails first 2 times, succeeds on 3rd
  max_attempts: 5
  retry_interval: 1

Expected:
  outputs.exit_code: "0"
  outputs.result: # Success output
  # Should only run 3 attempts total
```

### Test 10: Output with Special Characters
```yaml
Input:
  command: printf 'line1\nline2\ttab\nline3'

Expected:
  outputs.result: "line1\nline2\ttab\nline3"
```

### Test 11: Empty Output
```yaml
Input:
  command: exit 0  # No output

Expected:
  outputs.result: ""
  outputs.exit_code: "0"
```

### Test 12: Very Long Output
```yaml
Input:
  command: # Generate 100KB+ output

Expected:
  # Should handle without truncation (up to GitHub limits)
```

### Test 13: Timing Verification
```yaml
Input:
  command: exit 1
  max_attempts: 3
  retry_interval: 2

Expected:
  # Total runtime should be ~4+ seconds (2s + 2s sleep)
  # 3 attempts: attempt 1 (fail), sleep 2s, attempt 2 (fail), sleep 2s, attempt 3 (fail)
```

## Known Issues in Current Implementation

### Issue 1: Delimiter Collision
- **Location**: action.yaml:43-45
- **Problem**: Fixed "EOS" delimiter can collide with command output
- **Example**: `printf 'line1\nEOS\nline3'` will break output parsing
- **Fix Required**: Use random/unique delimiter

### Issue 2: Non-portable echo -e
- **Location**: action.yaml:36-40
- **Problem**: `echo -e` behavior varies across platforms
- **Fix Required**: Use `printf` instead

### Issue 3: Unquoted Variable
- **Location**: action.yaml:52
- **Problem**: `sleep $retry_interval` should be quoted
- **Fix Required**: `sleep "$retry_interval"`

## Implementation Notes for JavaScript Version

1. **Command Execution**:
   - Use `child_process.spawn` or `exec` with shell: true
   - Capture both stdout and stderr
   - Set working directory via `cwd` option

2. **Output Handling**:
   - Use `@actions/core.setOutput()` for GitHub Actions outputs
   - Handle multiline strings properly

3. **Retry Logic**:
   - Implement same loop: for i from 1 to max_attempts
   - Same success/failure conditions
   - Same logging format

4. **Compatibility**:
   - Must work on Linux, macOS, and Windows
   - Use cross-platform shell invocation

5. **Testing**:
   - Mock `child_process` for unit tests
   - Integration tests with actual commands
   - Verify timing for retry intervals
