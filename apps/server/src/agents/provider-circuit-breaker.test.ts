import { describe, expect, it } from 'vitest';

import { CircuitOpenError, ProviderCircuitBreaker } from './provider-circuit-breaker.js';

describe('ProviderCircuitBreaker', () => {
  it('永久错误立即开路，冷却后只放行一个探测并由成功关闭', () => {
    let now = 0;
    const breaker = new ProviderCircuitBreaker({ cooldownMs: 100, now: () => now });
    breaker.beforeLogicalCall();
    breaker.recordFailure('permanent');
    expect(() => breaker.beforeLogicalCall()).toThrow(CircuitOpenError);

    now = 100;
    expect(() => breaker.beforeLogicalCall()).not.toThrow();
    expect(breaker.snapshot().state).toBe('half_open');
    expect(() => breaker.beforeLogicalCall()).toThrow(CircuitOpenError);
    breaker.recordSuccess();
    expect(breaker.snapshot()).toEqual({ state: 'closed' });
    expect(() => breaker.beforeLogicalCall()).not.toThrow();
  });

  it('瞬时错误只在窗口内达到阈值后开路，探测失败继续冷却', () => {
    let now = 0;
    const breaker = new ProviderCircuitBreaker({
      failureThreshold: 2,
      failureWindowMs: 50,
      cooldownMs: 100,
      now: () => now,
    });
    breaker.recordFailure('transient');
    expect(breaker.snapshot().state).toBe('closed');
    now = 20;
    breaker.recordFailure('transient');
    expect(breaker.snapshot().state).toBe('open');
    now = 120;
    breaker.beforeLogicalCall();
    breaker.recordFailure('transient');
    expect(breaker.snapshot()).toEqual({ state: 'open', openUntil: 220 });
  });
});
