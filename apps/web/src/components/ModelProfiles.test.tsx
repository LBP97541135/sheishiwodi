import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelProfiles } from './ModelProfiles';

const profile = (roleId: string, displayName: string, selectedModelId: string | null) => ({
  profileId: roleId,
  displayName,
  intro: `${displayName} 内置角色`,
  personalityTags: ['标签甲', '标签乙', '标签丙'],
  personalityPrompt: `${displayName}的表达风格。`,
  source: 'built_in',
  allowedParticipantKinds: ['agent'],
  immutable: true,
  complete: true,
  selectedModelId,
  assets: {
    avatar: `builtin:${roleId}:avatar`,
    idle: `builtin:${roleId}:idle`,
    thinking: `builtin:${roleId}:thinking`,
    speaking: `builtin:${roleId}:speaking`,
    suspected: `builtin:${roleId}:suspected`,
    eliminated: `builtin:${roleId}:eliminated`,
  },
  createdAt: null,
  updatedAt: null,
});

const profileList = (overrides: Record<string, unknown> = {}) => ({
  providerMode: 'tokendance',
  providerConfigured: true,
  reviewModelConfigured: true,
  editable: true,
  profiles: [
    profile('deepseek', 'DeepSeek', 'gpt-existing'),
    profile('doubao', '豆包', null),
    profile('qwen', '千问', null),
  ],
  ...overrides,
});

const successBody = (data: unknown) => ({ data });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

function routeFetch(handlers: {
  profiles: unknown;
  models: unknown;
  put?: (roleId: string) => unknown;
}) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/character-profiles') return Promise.resolve(response(successBody(handlers.profiles)));
    if (url === '/api/models') return Promise.resolve(response(successBody(handlers.models)));
    if (init?.method === 'PUT') {
      const roleId = url.split('/').pop() ?? '';
      return Promise.resolve(response(successBody(handlers.put?.(roleId))));
    }
    throw new Error(`未预期的请求 ${url}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ModelProfiles', () => {
  it('展示三位 AI 角色档案与真实模型状态', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        profiles: profileList(),
        models: { providerMode: 'tokendance', models: ['gpt-a', 'gpt-b'] },
      }),
    );

    render(<ModelProfiles onBack={() => {}} />);

    expect(await screen.findByRole('heading', { name: '角色与模型' })).toBeInTheDocument();
    expect(screen.getByTestId('model-card-deepseek')).toBeInTheDocument();
    expect(screen.getByTestId('model-card-doubao')).toBeInTheDocument();
    expect(screen.getByTestId('model-card-qwen')).toBeInTheDocument();
    expect(screen.getByTestId('provider-mode')).toHaveTextContent('真实模型已接入');
  });

  it('保存时以 PUT 提交所选 model，DOM 不泄露 Base URL 或 API Key', async () => {
    const fetchMock = routeFetch({
      profiles: profileList(),
      models: { providerMode: 'tokendance', models: ['gpt-a', 'gpt-b'] },
      put: () => ({
        roleId: 'doubao',
        displayName: '豆包',
        personalityTags: ['标签甲', '标签乙', '标签丙'],
        personalityPrompt: '豆包的表达风格。',
        selectedModelId: 'gpt-b',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<ModelProfiles onBack={() => {}} />);
    await screen.findByTestId('model-card-doubao');

    const input = screen.getByTestId('model-card-doubao').querySelector('input')!;
    fireEvent.change(input, { target: { value: 'gpt-b' } });
    const saveButton = screen.getByTestId('model-card-doubao').querySelector('button')!;
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/model-profiles/doubao',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ modelId: 'gpt-b' }) }),
      ),
    );
    expect(await screen.findByText(/已更新 豆包 的模型/)).toBeInTheDocument();

    // 负向隔离：绝不出现中转站 URL、Bearer Key 或请求头。
    expect(container.innerHTML).not.toContain('tokendance.space');
    expect(container.innerHTML).not.toContain('gateway/v1');
    expect(container.innerHTML).not.toContain('Bearer');
    expect(container.innerHTML.toLowerCase()).not.toContain('authorization');
    expect(container.innerHTML.toLowerCase()).not.toContain('api_key');
    expect(container.innerHTML.toLowerCase()).not.toContain('apikey');
  });

  it('假模型模式下禁用选择并提示无需联网', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        profiles: profileList({ providerMode: 'fake', providerConfigured: false, editable: true }),
        models: { providerMode: 'fake', models: [] },
      }),
    );

    render(<ModelProfiles onBack={() => {}} />);
    await screen.findByTestId('model-card-deepseek');

    expect(screen.getByTestId('provider-mode')).toHaveTextContent('内置假模型');
    const input = screen.getByTestId('model-card-deepseek').querySelector('input')!;
    expect(input).toBeDisabled();
  });

  it('对局进行中锁定配置：禁用选择并给出提示', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        profiles: profileList({ editable: false }),
        models: { providerMode: 'tokendance', models: ['gpt-a'] },
      }),
    );

    render(<ModelProfiles onBack={() => {}} />);
    await screen.findByTestId('model-card-deepseek');

    expect(screen.getByText(/对局进行中，暂不能修改角色或模型配置/)).toBeInTheDocument();
    const input = screen.getByTestId('model-card-deepseek').querySelector('input')!;
    expect(input).toBeDisabled();
  });

  it('通用中转站允许手填 model ID，并提示必须配置评测模型', async () => {
    const fetchMock = routeFetch({
      profiles: profileList({
        providerMode: 'openai-compatible',
        reviewModelConfigured: false,
        profiles: [
          profile('deepseek', 'DeepSeek', null),
          profile('doubao', '豆包', null),
          profile('qwen', '千问', null),
        ],
      }),
      // 某些兼容中转站没有 /models；候选列表为空仍必须允许手填。
      models: { providerMode: 'openai-compatible', models: [] },
      put: () => ({
        roleId: 'deepseek',
        displayName: 'DeepSeek',
        personalityTags: ['标签甲', '标签乙', '标签丙'],
        personalityPrompt: 'DeepSeek的表达风格。',
        selectedModelId: 'vendor/custom-model',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ModelProfiles onBack={() => {}} />);
    const card = await screen.findByTestId('model-card-deepseek');

    expect(screen.getByTestId('provider-mode')).toHaveTextContent('通用 OpenAI 兼容中转站');
    expect(screen.getByText(/OPENAI_COMPATIBLE_REVIEW_MODEL/)).toBeInTheDocument();

    const input = card.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'vendor/custom-model' } });
    fireEvent.click(card.querySelector('button')!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/model-profiles/deepseek',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ modelId: 'vendor/custom-model' }),
        }),
      ),
    );
  });
});
