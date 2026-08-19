import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokendanceClient, TokendanceError } from './tokendance-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TokendanceClient request body precedence', () => {
  it('model 专属参数覆盖全局参数，但不能替换 model 和 messages', async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    const client = new TokendanceClient({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'secret',
      defaultBody: {
        temperature: 1,
        thinking: { type: 'enabled' },
        model: 'global-wrong-model',
        messages: [{ role: 'user', content: 'global-wrong-message' }],
      },
    });
    const messages = [{ role: 'user' as const, content: 'actual-message' }];

    await client.chatCompletion({
      modelId: 'actual-model',
      messages,
      extraBody: {
        temperature: 0,
        thinking: { type: 'disabled' },
        model: 'model-specific-wrong-model',
        messages: [{ role: 'user', content: 'model-specific-wrong-message' }],
      },
    });

    expect(requestBody).toMatchObject({
      temperature: 0,
      thinking: { type: 'disabled' },
      model: 'actual-model',
      messages,
    });
  });

  it('外部停机信号与超时使用不同的脱敏错误分类', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const client = new TokendanceClient({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'secret',
      timeoutMs: 10_000,
    });
    const controller = new AbortController();
    const pending = client.chatCompletion({
      modelId: 'model',
      messages: [{ role: 'user', content: 'hello' }],
      signal: controller.signal,
    });

    controller.abort();
    await expect(pending).rejects.toEqual(new TokendanceError('interrupted'));
  });
});
