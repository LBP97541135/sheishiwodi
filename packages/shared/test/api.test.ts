import { describe, expect, it } from 'vitest';

import { apiErrorResponseSchema, apiSuccessSchema, humanGameViewSchema } from '../src/index.js';

describe('API 信封', () => {
  it('接受安全错误响应', () => {
    const response = apiErrorResponseSchema.parse({
      error: {
        code: 'INVALID_TRANSITION',
        message: '当前阶段不能执行该操作',
      },
    });

    expect(response.error.details).toEqual({});
  });

  it('为游戏视图生成成功响应 Schema', () => {
    const schema = apiSuccessSchema(humanGameViewSchema.nullable());

    expect(
      schema.safeParse({
        data: null,
      }).success,
    ).toBe(true);
  });
});
