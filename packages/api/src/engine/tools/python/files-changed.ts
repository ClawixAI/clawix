/**
 * Parses the output of a `find` command into a list of file paths.
 *
 * @param stdout - Raw stdout string from the `find` command (one path per line).
 * @returns Array of non-empty trimmed path strings.
 */
export function parseFindOutput(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
