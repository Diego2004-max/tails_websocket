/**
 * Full-jitter exponential backoff.
 * delay = random(0, min(cap, base * 2^attempt))
 * Spreads a reconnection avalanche (50,000 clients of a dead instance) over time
 * instead of synchronizing everyone on the same retry tick.
 */
export class ReconnectPolicy {
  private attempt = 0;
  constructor(
    private readonly baseMs = 500,
    private readonly capMs = 30_000,
    private readonly jitter = true,
    private readonly random: () => number = Math.random,
  ) {}

  next(): number {
    const ceiling = Math.min(this.capMs, this.baseMs * 2 ** this.attempt);
    this.attempt += 1;
    return this.jitter ? Math.floor(this.random() * ceiling) : ceiling;
  }
  reset(): void {
    this.attempt = 0;
  }
}
