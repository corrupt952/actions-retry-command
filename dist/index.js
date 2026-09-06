import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { spawn } from 'node:child_process';

/**
 * The subset of the Actions toolkit this action needs, implemented against the
 * documented runner protocol: inputs arrive as INPUT_* environment variables,
 * outputs are appended to the file named by GITHUB_OUTPUT, and logging goes
 * through workflow commands on stdout.
 */
function getInput(name, options) {
    const value = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
    if (options?.required && !value) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return (value || '').trim();
}
function escapeData(value) {
    return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function info(message) {
    process.stdout.write(`${message}${EOL}`);
}
function startGroup(name) {
    process.stdout.write(`::group::${escapeData(name)}${EOL}`);
}
function endGroup() {
    process.stdout.write(`::endgroup::${EOL}`);
}
function setOutput(name, value) {
    const filePath = process.env.GITHUB_OUTPUT;
    if (!filePath) {
        throw new Error('Unable to find environment variable for file command OUTPUT');
    }
    // A random delimiter keeps arbitrary command output from terminating the
    // heredoc early, which is what the runner documentation warns about.
    const delimiter = `ghadelimiter_${randomUUID()}`;
    appendFileSync(filePath, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`, { encoding: 'utf8' });
}
function setFailed(message) {
    process.exitCode = 1;
    process.stdout.write(`::error::${escapeData(message)}${EOL}`);
}

const FUNCTIONS = {
    random: (n) => Math.floor(Math.random() * n),
    min: (a, b) => Math.min(a, b),
    max: (a, b) => Math.max(a, b),
    floor: (n) => Math.floor(n),
    ceil: (n) => Math.ceil(n)
};
function evaluateExpression(input, vars = {}) {
    let pos = 0;
    function peek() {
        while (pos < input.length && /\s/.test(input[pos]))
            pos++;
        return input[pos] || '';
    }
    function advance() {
        return input[pos++];
    }
    function match(ch) {
        if (peek() === ch) {
            pos++;
            return true;
        }
        return false;
    }
    function parseExpr() {
        let left = parseTerm();
        while (true) {
            if (match('+'))
                left = left + parseTerm();
            else if (match('-'))
                left = left - parseTerm();
            else
                break;
        }
        return left;
    }
    function parseTerm() {
        let left = parsePower();
        while (true) {
            if (match('*'))
                left = left * parsePower();
            else if (match('/'))
                left = left / parsePower();
            else if (match('%'))
                left = left % parsePower();
            else
                break;
        }
        return left;
    }
    function parsePower() {
        const base = parseUnary();
        if (match('^'))
            return base ** parsePower();
        return base;
    }
    function parseUnary() {
        if (match('-'))
            return -parsePrimary();
        if (match('+'))
            return +parsePrimary();
        return parsePrimary();
    }
    function parsePrimary() {
        if (/[0-9.]/.test(peek())) {
            let num = '';
            while (pos < input.length && /[0-9.]/.test(input[pos]))
                num += advance();
            return parseFloat(num);
        }
        if (/[a-zA-Z_]/.test(peek())) {
            let name = '';
            while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]))
                name += advance();
            if (peek() === '(') {
                advance();
                const args = [];
                if (peek() !== ')') {
                    args.push(parseExpr());
                    while (match(','))
                        args.push(parseExpr());
                }
                if (!match(')'))
                    throw new Error("Expected ')'");
                const fn = FUNCTIONS[name];
                if (!fn)
                    throw new Error(`Unknown function: ${name}`);
                return fn(...args);
            }
            if (!Object.hasOwn(vars, name))
                throw new Error(`Undefined variable: ${name}`);
            return vars[name];
        }
        if (match('(')) {
            const val = parseExpr();
            if (!match(')'))
                throw new Error("Expected ')'");
            return val;
        }
        throw new Error(`Unexpected '${peek()}' at position ${pos}`);
    }
    const result = parseExpr();
    if (pos < input.length && /\S/.test(input.slice(pos))) {
        throw new Error(`Unexpected '${input[pos]}' at position ${pos}`);
    }
    return result;
}

function shouldRetry(exitCode, retryOnExitCode) {
    if (exitCode === 0)
        return false;
    if (retryOnExitCode === null)
        return true;
    return retryOnExitCode.includes(exitCode);
}
function parseRetryOnExitCode(input) {
    if (!input)
        return null;
    return input
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Windows has no process groups to signal, so the child is only detached
// where killing the whole tree actually works.
const useProcessGroup = process.platform !== 'win32';
function executeCommand(command, shell, timeout, workingDirectory) {
    return new Promise((resolve, reject) => {
        info(`[command]${shell} -c ${command}`);
        const child = spawn(shell, ['-c', command], {
            ...(workingDirectory && { cwd: workingDirectory }),
            detached: useProcessGroup,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let timer;
        child.stdout.on('data', (data) => {
            stdout += data.toString();
            process.stdout.write(data);
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
            process.stderr.write(data);
        });
        if (timeout !== null) {
            timer = setTimeout(() => {
                timedOut = true;
                const pid = child.pid;
                if (pid === undefined)
                    return;
                try {
                    // Negating the pid signals the whole group, so children the command
                    // spawned are torn down with it.
                    process.kill(useProcessGroup ? -pid : pid, 'SIGKILL');
                }
                catch {
                    // The process is already gone; nothing left to kill.
                }
            }, timeout * 1000);
        }
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                exitCode: timedOut ? 124 : (code ?? 1),
                output: (stdout + stderr).trimEnd()
            });
        });
    });
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
async function run() {
    try {
        const command = getInput('command', { required: true });
        const maxAttempts = parseInt(getInput('max_attempts') || '5', 10);
        const retryInterval = getInput('retry_interval') || '5';
        const timeoutInput = getInput('timeout');
        const timeout = timeoutInput ? parseInt(timeoutInput, 10) : null;
        if (timeout !== null && (Number.isNaN(timeout) || timeout < 0)) {
            setFailed('timeout must be a non-negative integer');
            return;
        }
        if (Number.isNaN(maxAttempts) || maxAttempts < 1) {
            setFailed('max_attempts must be a positive integer');
            return;
        }
        const shell = getInput('shell') || 'bash';
        const workingDirectory = getInput('working_directory') || '';
        const retryOnExitCode = parseRetryOnExitCode(getInput('retry_on_exit_code'));
        let lastExitCode = 0;
        let lastOutput = '';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            startGroup(`Attempt ${attempt} of ${maxAttempts}`);
            const result = await executeCommand(command, shell, timeout, workingDirectory);
            lastExitCode = result.exitCode;
            lastOutput = result.output;
            endGroup();
            if (result.exitCode === 0) {
                break;
            }
            if (attempt === maxAttempts) {
                break;
            }
            if (!shouldRetry(result.exitCode, retryOnExitCode)) {
                info(`Exit code ${result.exitCode} is not in retry list, stopping retries`);
                break;
            }
            const sleepSeconds = evaluateExpression(retryInterval, {
                attempt,
                max_attempts: maxAttempts
            });
            if (sleepSeconds < 0) {
                setFailed('retry_interval evaluated to a negative number');
                return;
            }
            info(`Retrying in ${sleepSeconds} seconds...`);
            await sleep(sleepSeconds * 1000);
        }
        setOutput('exit_code', lastExitCode.toString());
        setOutput('result', lastOutput);
        if (lastExitCode !== 0) {
            setFailed(`Command failed with exit code ${lastExitCode}`);
        }
    }
    catch (error) {
        if (error instanceof Error)
            setFailed(error.message);
        else
            setFailed(String(error));
    }
}

/**
 * The entrypoint for the action. This file simply imports and runs the action's
 * main logic.
 */
/* istanbul ignore next */
run();
//# sourceMappingURL=index.js.map
