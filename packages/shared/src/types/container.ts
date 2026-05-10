/** A mount requested by an agent definition (stored in DB). */
export interface AgentMount {
  readonly hostPath: string;
  readonly containerPath?: string;
  readonly readonly?: boolean;
}

/** An entry in the host-level allowlist defining a permitted root path. */
export interface AllowedRoot {
  readonly path: string;
  readonly allowReadWrite: boolean;
  readonly description: string;
}

/** Host-level mount allowlist loaded from ~/.config/clawix/mount-allowlist.json. */
export interface MountAllowlist {
  readonly allowedRoots: readonly AllowedRoot[];
  readonly blockedPatterns: readonly string[];
}

/** Result of validating a single mount request. */
export interface MountValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly effectiveReadonly: boolean;
}

/** A mount that has passed validation and is ready for docker run -v. */
export interface ValidatedMount {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readonly: boolean;
}

/** Options for executing a command inside a running container. */
export interface ExecOptions {
  readonly stdin?: string;
  readonly workdir?: string;
  readonly timeout?: number;
  /**
   * Optional signal to abort the in-flight `docker exec`. When fired,
   * the child receives SIGTERM and exec() resolves with `{ exitCode: -1, ... }`
   * (does not throw).
   */
  readonly signal?: AbortSignal;
}

/** Result of executing a command inside a container. */
export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
