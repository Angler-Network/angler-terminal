/**
 * Nonces are per API key and must increase by exactly 1. Sends on one key are serialized through this queue with
 * a local counter, so two quick clicks never sign the same nonce.
 *
 * - API rejection (`sendTx` code ≠ 200): the nonce wasn't consumed; keep it. On 21104 (invalid nonce) refetch it
 *   and retry once: the server refused the tx, so it can't have executed.
 * - Unknown outcome (network error after sending): drop the counter so the next send refetches `nextNonce`. Never
 *   re-sign automatically: the first tx may still execute.
 */

export const INVALID_NONCE_CODE = 21104;

export interface NonceOutcome<T> {
  value: T;
  /** False when the server rejected the tx before the sequencer (nonce not consumed). */
  consumed: boolean;
}

export class NonceRejectedError extends Error {
  constructor(readonly code: number) {
    super(`nonce rejected (${code})`);
  }
}

export class NonceQueue {
  private next: number | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly fetchNonce: () => Promise<number>) {}

  /** Forget the local counter (e.g. after another app used the same key). */
  reset() {
    this.next = null;
  }

  /**
   * Runs `send` with the next nonce, one at a time. `send` resolves with whether the nonce was consumed and throws
   * an error with a numeric `code` when the API rejected the tx.
   */
  run<T>(send: (nonce: number) => Promise<NonceOutcome<T>>): Promise<T> {
    const task = this.tail.then(() => this.attempt(send, true));
    this.tail = task.catch(() => {});
    return task;
  }

  private async attempt<T>(send: (nonce: number) => Promise<NonceOutcome<T>>, mayRetry: boolean): Promise<T> {
    if (this.next === null) this.next = await this.fetchNonce();
    const nonce = this.next;
    try {
      const outcome = await send(nonce);
      this.next = outcome.consumed ? nonce + 1 : nonce;
      return outcome.value;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code !== "number") {
        // Unknown outcome: the tx may have been accepted. Refetch next time instead of guessing.
        this.next = null;
        throw error;
      }
      if (code === INVALID_NONCE_CODE && mayRetry) {
        this.next = null;
        return this.attempt(send, false);
      }
      // Rejected by the API: the nonce is still free.
      this.next = nonce;
      throw error;
    }
  }
}
