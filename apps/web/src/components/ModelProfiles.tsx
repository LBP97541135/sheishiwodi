import { useEffect, useState } from 'react';

import type { ModelProfile, ModelProfileList } from '@sheishiwodi/shared';

import { ApiClientError, getModelProfiles, getModels, updateModelSelection } from '../api';
import type { CharacterKey } from '../character-assets';
import { CharacterPortrait } from './CharacterPortrait';

interface ModelProfilesProps {
  onBack: () => void;
}

type LoadState = 'loading' | 'ready' | 'failed';

// roleId（deepseek/doubao/qwen）与角色立绘 key 一致，直接复用。
const roleCharacterKey = (roleId: string): CharacterKey =>
  roleId === 'doubao' ? 'doubao' : roleId === 'qwen' ? 'qwen' : 'deepseek';

export function ModelProfiles({ onBack }: ModelProfilesProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [list, setList] = useState<ModelProfileList | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    void Promise.all([getModelProfiles(), getModels().catch(() => null)])
      .then(([profiles, available]) => {
        if (!active) return;
        setList(profiles);
        setModels(available?.models ?? []);
        setDrafts(
          Object.fromEntries(
            profiles.profiles.map((profile) => [profile.roleId, profile.selectedModelId ?? '']),
          ),
        );
        setLoadState('ready');
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(messageFor(loadError));
        setLoadState('failed');
      });
    return () => {
      active = false;
    };
  }, []);

  const providerMode = list?.providerMode ?? 'fake';
  const providerConfigured = list?.providerConfigured ?? false;
  const editable = (list?.editable ?? false) && providerConfigured;

  const handleSave = async (profile: ModelProfile) => {
    const modelId = (drafts[profile.roleId] ?? '').trim();
    if (!modelId) {
      setError('请填写一个 model ID 后再保存');
      return;
    }
    setSavingRole(profile.roleId);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateModelSelection(profile.roleId, modelId);
      setList((current) =>
        current
          ? {
              ...current,
              profiles: current.profiles.map((item) =>
                item.roleId === updated.roleId ? updated : item,
              ),
            }
          : current,
      );
      setNotice(`已保存 ${updated.displayName} 的模型：${updated.selectedModelId}`);
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setSavingRole(null);
    }
  };

  if (loadState === 'loading') {
    return (
      <section className="storyboard" aria-labelledby="model-title">
        <p className="eyebrow">模型档案</p>
        <h1 id="model-title">正在读取模型档案…</h1>
      </section>
    );
  }

  if (loadState === 'failed' || !list) {
    return (
      <section className="storyboard" aria-labelledby="model-title">
        <p className="eyebrow">模型档案</p>
        <h1 id="model-title">无法读取模型档案</h1>
        <p className="lede">{error ?? '请确认本地服务已启动。'}</p>
        <button type="button" className="secondary-action" onClick={onBack}>
          返回对局
        </button>
      </section>
    );
  }

  return (
    <section className="storyboard model-profiles" aria-labelledby="model-title">
      <header className="model-profiles__header">
        <div>
          <p className="eyebrow">模型档案</p>
          <h1 id="model-title">为三位 AI 选择模型</h1>
        </div>
        <button type="button" className="secondary-action" onClick={onBack}>
          返回对局
        </button>
      </header>

      <p className="lede" data-testid="provider-mode">
        {providerConfigured
          ? providerMode === 'openai-compatible'
            ? '通用 OpenAI 兼容中转站已接入。请为三位 AI 手动填写或选择 model ID。'
            : '真实模型已接入（tokendance）。可为每位 AI 填写或选择 model ID。'
          : providerMode === 'tokendance'
            ? '已选择 tokendance，但服务端尚未配置 Base URL 或 API Key，暂用内置假模型。'
            : providerMode === 'openai-compatible'
              ? '已选择通用 OpenAI 兼容中转站，但服务端尚未配置 Base URL 或 API Key，暂用内置假模型。'
              : '当前使用内置假模型（fake），无需联网。可切换服务端配置以接入真实模型。'}
      </p>
      {providerMode === 'openai-compatible' && providerConfigured && !list.reviewModelConfigured && (
        <p className="form-hint" role="status">
          评测模型未配置。请在服务端设置 OPENAI_COMPATIBLE_REVIEW_MODEL，配齐前不能开始游戏。
        </p>
      )}
      {!editable && providerConfigured && (
        <p className="form-hint" role="status">
          对局进行中，暂不能修改模型配置；请在对局结束后再来调整。
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}

      <div className="model-profiles__grid">
        {list.profiles.map((profile) => {
          const draft = drafts[profile.roleId] ?? '';
          const options = modelOptions(models, profile.selectedModelId, draft);
          const suggestionsId = `model-options-${profile.roleId}`;
          return (
            <article
              key={profile.roleId}
              className="model-card"
              data-testid={`model-card-${profile.roleId}`}
            >
              <CharacterPortrait
                characterKey={roleCharacterKey(profile.roleId)}
                label={profile.displayName}
                state="idle"
              />
              <h2 className="model-card__name">{profile.displayName}</h2>
              <ul className="model-card__tags">
                {profile.personalityTags.map((tag) => (
                  <li key={tag} className="model-card__tag">
                    {tag}
                  </li>
                ))}
              </ul>
              <p className="model-card__prompt">{profile.personalityPrompt}</p>

              <label className="model-card__field">
                <span>模型 ID</span>
                <input
                  type="text"
                  value={draft}
                  disabled={!editable}
                  list={suggestionsId}
                  maxLength={128}
                  autoComplete="off"
                  placeholder="手动填写或选择 model ID"
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [profile.roleId]: event.target.value }))
                  }
                />
                <datalist id={suggestionsId}>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </datalist>
              </label>

              <p className="model-card__current">
                当前：{profile.selectedModelId ?? '未配置'}
              </p>

              <button
                type="button"
                className="primary-action"
                disabled={!editable || savingRole === profile.roleId}
                onClick={() => void handleSave(profile)}
              >
                {savingRole === profile.roleId ? '保存中…' : '保存'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// 合并可选目录、当前已选与草稿值，保证界面能显示已保存但目录暂缺的 model。
function modelOptions(models: string[], selected: string | null, draft: string): string[] {
  const set = new Set(models);
  if (selected) set.add(selected);
  if (draft) set.add(draft);
  return [...set];
}

function messageFor(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return '无法连接本地服务，请确认 pnpm dev 正在运行';
}
