export type CircuitFailureKind = 'permanent' | 'transient';
export type ProviderCircuitState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
  constructor() {
    super('PROVIDER_CIRCUIT_OPEN');
    this.name = 'CircuitOpenError';
  }
}

export interface ProviderCircuitBreakerPort {
  beforeLogicalCall(): void;
  recordSuccess(): void;
  recordFailure(kind: CircuitFailureKind): void;
  snapshot(): { state: ProviderCircuitState; openUntil?: number };
}

export const noOpProviderCircuitBreaker: ProviderCircuitBreakerPort = {
  beforeLogicalCall: () => undefined,
  recordSuccess: () => undefined,
  recordFailure: () => undefined,
  snapshot: () => ({ state: 'closed' }),
};

export class ProviderCircuitBreaker implements ProviderCircuitBreakerPort {
  private state: ProviderCircuitState = 'closed';
  private openUntil = 0;
  private probeInFlight = false;
  private transientFailures: number[] = [];

  constructor(
    private readonly options: {
      failureThreshold?: number;
      failureWindowMs?: number;
      cooldownMs?: number;
      now?: () => number;
    } = {},
  ) {}

  beforeLogicalCall() {
    const now = this.now();
    if (this.state === 'closed') return;
    if (this.state === 'open') {
      if (now < this.openUntil) throw new CircuitOpenError();
      this.state = 'half_open';
      this.probeInFlight = true;
      return;
    }
    if (this.probeInFlight) throw new CircuitOpenError();
    this.probeInFlight = true;
  }

  recordSuccess() {
    this.state = 'closed';
    this.openUntil = 0;
    this.probeInFlight = false;
    this.transientFailures = [];
  }

  recordFailure(kind: CircuitFailureKind) {
    const now = this.now();
    if (kind === 'permanent' || this.state === 'half_open') {
      this.open(now);
      return;
    }
    const windowStart = now - (this.options.failureWindowMs ?? 60_000);
    this.transientFailures = this.transientFailures.filter((value) => value >= windowStart);
    this.transientFailures.push(now);
    if (this.transientFailures.length >= (this.options.failureThreshold ?? 3)) {
      this.open(now);
    }
  }

  snapshot(): { state: ProviderCircuitState; openUntil?: number } {
    return this.state === 'closed'
      ? { state: this.state }
      : { state: this.state, openUntil: this.openUntil };
  }

  private open(now: number) {
    this.state = 'open';
    this.openUntil = now + (this.options.cooldownMs ?? 30_000);
    this.probeInFlight = false;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }
}
