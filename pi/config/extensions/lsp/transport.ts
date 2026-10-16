import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as rpc from "vscode-jsonrpc/node";

/** Owns one server process and bounds every wait on its JSON-RPC connection. */
export class LspTransport {
  readonly conn: rpc.MessageConnection;
  readonly proc: ChildProcessWithoutNullStreams;
  private stderr = "";
  private failure?: Error;
  private readonly waiters = new Set<(error: Error) => void>();
  private killTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly name: string,
    bin: string,
    args: string[],
    root: string,
    private readonly onStop: () => void,
    private readonly requestMs = 30_000,
  ) {
    this.proc = spawn(bin, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8192);
    });
    this.conn = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.proc.stdout),
      new rpc.StreamMessageWriter(this.proc.stdin),
    );
    this.proc.on("error", (error) => this.stop(`could not start: ${error.message}`));
    this.proc.on("exit", (code, signal) => {
      if (this.killTimer) clearTimeout(this.killTimer);
      this.stop(`exited (code ${code}, signal ${signal ?? "none"})`);
    });
    this.conn.onClose(() => this.stop("closed its connection"));
    this.conn.onError(([error]) => this.stop(`connection error: ${error.message}`));
  }

  /** Also used for shared initialization: aborting a caller need not abort its peers. */
  async wait<T>(promise: Promise<T>, method: string, signal?: AbortSignal, timeoutMs = this.requestMs): Promise<T> {
    let cleanup = () => {};
    try {
      return await new Promise<T>((resolve, reject) => {
        // Subscribe even when already aborted: the shared promise may reject later.
        promise.then(resolve, reject);
        if (this.failure) { reject(this.failure); return; }
        if (signal?.aborted) { reject(signal.reason); return; }
        const aborted = () => reject(signal?.reason ?? new Error("LSP request aborted"));
        const failed = (error: Error) => reject(error);
        const timer = setTimeout(() => {
          this.stop(`timed out after ${timeoutMs}ms waiting for ${method}`);
        }, timeoutMs);
        this.waiters.add(failed);
        signal?.addEventListener("abort", aborted, { once: true });
        cleanup = () => {
          clearTimeout(timer);
          this.waiters.delete(failed);
          signal?.removeEventListener("abort", aborted);
        };
      });
    } finally {
      cleanup();
    }
  }

  async request<T>(method: string, params: unknown, signal?: AbortSignal, timeoutMs = this.requestMs): Promise<T> {
    if (this.failure) throw this.failure;
    signal?.throwIfAborted();
    const token = new rpc.CancellationTokenSource();
    try {
      return await this.wait(this.conn.sendRequest<T>(method, params, token.token), method, signal, timeoutMs);
    } finally {
      token.cancel();
      token.dispose();
    }
  }

  stop(reason: string): void {
    if (this.failure) return;
    this.failure = new Error(`${this.name} ${reason}${this.stderr.trim() ? `\n${this.stderr.trim()}` : ""}`);
    for (const failed of this.waiters) failed(this.failure);
    this.onStop();
    this.conn.dispose();
    if (this.proc.exitCode === null && this.proc.signalCode === null) {
      this.proc.kill();
      this.killTimer = setTimeout(() => this.proc.kill("SIGKILL"), 1000);
      this.killTimer.unref();
    }
  }
}
