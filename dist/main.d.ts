/**
 * Retry a command with exponential backoff
 *
 * @param command - The shell command to execute
 * @param workingDirectory - Directory where command should run
 * @param maxAttempts - Maximum number of retry attempts
 * @param retryInterval - Seconds to wait between retries
 */
export declare function retryCommand(command: string, workingDirectory: string, maxAttempts: number, retryInterval: number): Promise<void>;
/**
 * Main entry point for the action
 */
export declare function run(): Promise<void>;
