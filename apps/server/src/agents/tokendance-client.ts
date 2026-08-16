/**
 * Tokendance（OpenAI 兼容中转站）网络客户端。
 * Base URL 与 API Key 只在本模块内使用，绝不写入日志、错误消息、数据库或对外投影。
 * 抛出的错误只带脱敏的分类与可选 HTTP 状态码，不含 URL、Key、请求头或完整响应体。
 */

export type TokendanceErrorKind = 'timeout' | 'network' | 'http' | 'bad_response';

export class TokendanceError extends Error {
  constructor(
    readonly kind: TokendanceErrorKind,
    readonly status?: number,
  ) {
    super(`TOKENDANCE_${kind.toUpperCase()}${status ? `_${status}` : ''}`);
    this.name = 'TokendanceError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TokendanceClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class TokendanceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: TokendanceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async listModels(): Promise<string[]> {
    const body = await this.request('GET', '/models');
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      throw new TokendanceError('bad_response');
    }
    return data
      .map((entry) => (entry as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  async chatCompletion(params: { modelId: string; messages: ChatMessage[] }): Promise<string> {
    const body = await this.request('POST', '/chat/completions', {
      model: params.modelId,
      messages: params.messages,
    });
    const content = (body as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
      ?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new TokendanceError('bad_response');
    }
    return content;
  }

  private async request(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };
      if (payload !== undefined) {
        init.body = JSON.stringify(payload);
      }
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TokendanceError('timeout');
      }
      throw new TokendanceError('network');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new TokendanceError('http', response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new TokendanceError('bad_response');
    }
  }
}
