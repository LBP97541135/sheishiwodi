import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelProfiles } from './ModelProfiles';

const profile = (roleId: string, displayName: string, selectedModelId: string | null) => ({
  roleId,
  displayName,
  personalityTags: ['标签甲', '标签乙', '标签丙'],
  personalityPrompt: `${displayName}的表达风格。`,
  selectedModelId,
});

const profileList = (overrides: Record<string, unknown> = {}) => ({
  providerMode: 'tokendance',
  providerConfigured: true,
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
    if (url === '/api/model-profiles') return Promise.resolve(response(successBody(handlers.profiles)));
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

    expect(await screen.findByRole('heading', { name: '为三位 AI 选择模型' })).toBeInTheDocument();
    expect(screen.getByTestId('model-card-deepseek')).toBeInTheDocument();
    expect(screen.getByTestId('model-card-doubao')).toBeInTheDocument();
    expect(screen.getByTestId('model-card-qwen')).toBeInTheDocument();
    expect(screen.getByTestId('provider-mode')).toHaveTextContent('真实模型已接入');
  });

  it('保存时以 PUT 提交所选 model，DOM 不泄露 Base URL 或 API Key', async () => {
    const fetchMock = routeFetch({
      profiles: profileList(),
      models: { providerMode: 'tokendance', models: ['gpt-a', 'gpt-b'] },
      put: () => profile('doubao', '豆包', 'gpt-b'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<ModelProfiles onBack={() => {}} />);
    await screen.findByTestId('model-card-doubao');

    const select = screen.getByTestId('model-card-doubao').querySelector('select')!;
    fireEvent.change(select, { target: { value: 'gpt-b' } });
    const saveButton = screen.getByTestId('model-card-doubao').querySelector('button')!;
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/model-profiles/doubao',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ modelId: 'gpt-b' }) }),
      ),
    );
    expect(await screen.findByText(/已保存 豆包 的模型/)).toBeInTheDocument();

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
    const select = screen.getByTestId('model-card-deepseek').querySelector('select')!;
    expect(select).toBeDisabled();
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

    expect(screen.getByText(/对局进行中，暂不能修改模型配置/)).toBeInTheDocument();
    const select = screen.getByTestId('model-card-deepseek').querySelector('select')!;
    expect(select).toBeDisabled();
  });
});
