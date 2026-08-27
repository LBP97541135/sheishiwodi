import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Copy, Pencil, Plus, Trash2, X } from 'lucide-react';

import type { CharacterAssetState, CharacterProfile, CharacterProfileList } from '@sheishiwodi/shared';

import {
  ApiClientError,
  copyCharacterProfile,
  createCharacterProfile,
  deleteCharacterProfile,
  getCharacterProfiles,
  getModels,
  updateCharacterProfile,
  updateModelSelection,
} from '../api';
import { characterAvatars, type CharacterKey } from '../character-assets';

interface ModelProfilesProps { onBack(): void }
type LoadState = 'loading' | 'ready' | 'failed';
const assetStates: Array<[CharacterAssetState, string]> = [
  ['avatar', '头像'], ['idle', '待机'], ['thinking', '思考'], ['speaking', '发言'], ['suspected', '被怀疑'], ['eliminated', '淘汰'],
];

interface EditorDraft {
  profileId?: string;
  displayName: string;
  intro: string;
  personalityTags: string;
  personalityPrompt: string;
  selectedModelId: string;
  assets: Partial<Record<CharacterAssetState, string>>;
}

const emptyDraft = (): EditorDraft => ({
  displayName: '', intro: '', personalityTags: '', personalityPrompt: '', selectedModelId: '', assets: {},
});

export function ModelProfiles({ onBack }: ModelProfilesProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [list, setList] = useState<CharacterProfileList | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => getCharacterProfiles().then((profiles) => {
    setList(profiles);
    setModelDrafts(Object.fromEntries(profiles.profiles.map((profile) => [profile.profileId, profile.selectedModelId ?? ''])));
    setLoadState('ready');
  });

  useEffect(() => {
    let active = true;
    void Promise.all([getCharacterProfiles(), getModels().catch(() => null)])
      .then(([profiles, available]) => {
        if (!active) return;
        setList(profiles);
        setModels(available?.models ?? []);
        setModelDrafts(Object.fromEntries(profiles.profiles.map((profile) => [profile.profileId, profile.selectedModelId ?? ''])));
        setLoadState('ready');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(messageFor(caught));
        setLoadState('failed');
      });
    return () => { active = false; };
  }, []);

  const openEditor = (profile?: CharacterProfile) => setEditor(profile ? {
    profileId: profile.profileId,
    displayName: profile.displayName,
    intro: profile.intro,
    personalityTags: profile.personalityTags.join('、'),
    personalityPrompt: profile.personalityPrompt,
    selectedModelId: profile.selectedModelId ?? '',
    assets: {},
  } : emptyDraft());

  const copy = async (profile: CharacterProfile) => {
    setBusyId(profile.profileId);
    setError(null);
    try {
      const copied = await copyCharacterProfile(profile.profileId);
      await reload();
      setNotice(`已创建独立副本“${copied.displayName}”`);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusyId(null);
    }
  };

  const saveBuiltInModel = async (profile: CharacterProfile) => {
    const modelId = modelDrafts[profile.profileId]?.trim();
    if (!modelId) return setError('请填写 model ID');
    setBusyId(profile.profileId);
    setError(null);
    try {
      await updateModelSelection(profile.profileId, modelId);
      await reload();
      setNotice(`已更新 ${profile.displayName} 的模型`);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (profile: CharacterProfile) => {
    if (!window.confirm(`删除自建角色“${profile.displayName}”？`)) return;
    setBusyId(profile.profileId);
    try {
      await deleteCharacterProfile(profile.profileId);
      await reload();
      setNotice('角色已删除');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusyId(null);
    }
  };

  if (loadState === 'loading') return <section className="storyboard"><p className="eyebrow">角色库</p><h1>正在读取角色…</h1></section>;
  if (loadState === 'failed' || !list) return <section className="storyboard"><h1>无法读取角色库</h1><p className="form-error">{error}</p><button className="secondary-action" onClick={onBack}>返回对局</button></section>;

  return (
    <section className="storyboard model-profiles character-library" aria-labelledby="role-library-title">
      <header className="model-profiles__header">
        <div><p className="eyebrow">本地角色库</p><h1 id="role-library-title">角色与模型</h1></div>
        <div className="action-row">
          <button className="primary-action" type="button" disabled={!list.editable} onClick={() => openEditor()}><Plus aria-hidden="true" />新建角色</button>
          <button className="secondary-action" type="button" onClick={onBack}>返回对局</button>
        </div>
      </header>
      <p className="lede" data-testid="provider-mode">{providerLabel(list.providerMode)}</p>
      {!list.editable && <p className="form-error">对局进行中，暂不能修改角色或模型配置。</p>}
      {list.providerMode === 'openai-compatible' && !list.reviewModelConfigured && <p className="form-error">请在环境变量中配置 OPENAI_COMPATIBLE_REVIEW_MODEL，评测模型不会使用默认值。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}

      <div className="model-profiles__grid role-library-grid">
        {list.profiles.filter((profile) => profile.allowedParticipantKinds.includes('agent')).map((profile) => {
          const agentEligible = profile.allowedParticipantKinds.includes('agent');
          return (
            <article key={profile.profileId} className="model-card role-card" data-testid={`model-card-${profile.profileId}`}>
              <img className="role-card__avatar" src={assetUrl(profile, 'avatar')} alt="" />
              <div className="role-card__heading">
                <h2>{profile.displayName}</h2>
                <span className={profile.complete ? 'status-badge is-ready' : 'status-badge'}>{profile.complete ? '可用' : '草稿'}</span>
              </div>
              <p>{profile.intro}</p>
              <ul className="model-card__tags">{profile.personalityTags.map((tag) => <li className="model-card__tag" key={tag}>{tag}</li>)}</ul>
              <p className="model-card__prompt">{profile.personalityPrompt || (agentEligible ? '未配置人格' : '人类专属形象')}</p>

              {agentEligible && profile.source === 'built_in' && (
                <label className="model-card__field"><span>模型 ID</span><input value={modelDrafts[profile.profileId] ?? ''} list="role-model-options" disabled={!list.editable || !list.providerConfigured} onChange={(event) => setModelDrafts((current) => ({ ...current, [profile.profileId]: event.target.value }))} /></label>
              )}
              {agentEligible && profile.source === 'custom' && <p className="model-card__current">模型：{profile.selectedModelId ?? '未配置'}</p>}

              <div className="role-card__actions">
                {profile.source === 'built_in' && agentEligible && list.providerConfigured && <button className="icon-action" type="button" title="保存模型" aria-label={`保存 ${profile.displayName} 模型`} disabled={busyId === profile.profileId || !list.editable} onClick={() => void saveBuiltInModel(profile)}><Pencil aria-hidden="true" /></button>}
                <button className="icon-action" type="button" title="复制角色" aria-label={`复制 ${profile.displayName}`} disabled={!list.editable || busyId === profile.profileId} onClick={() => void copy(profile)}><Copy aria-hidden="true" /></button>
                {profile.source === 'custom' && <button className="icon-action" type="button" title="编辑角色" aria-label={`编辑 ${profile.displayName}`} disabled={!list.editable} onClick={() => openEditor(profile)}><Pencil aria-hidden="true" /></button>}
                {profile.source === 'custom' && <button className="icon-action icon-action--danger" type="button" title="删除角色" aria-label={`删除 ${profile.displayName}`} disabled={!list.editable || busyId === profile.profileId} onClick={() => void remove(profile)}><Trash2 aria-hidden="true" /></button>}
              </div>
            </article>
          );
        })}
      </div>
      <datalist id="role-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
      {editor && <CharacterEditor draft={editor} providerMode={list.providerMode} onClose={() => setEditor(null)} onSaved={async () => {
        setEditor(null);
        await reload();
        setNotice('角色档案已保存');
      }} />}
    </section>
  );
}

function CharacterEditor({ draft, providerMode, onClose, onSaved }: { draft: EditorDraft; providerMode: CharacterProfileList['providerMode']; onClose(): void; onSaved(): Promise<void> }) {
  const [value, setValue] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileChanged = (state: CharacterAssetState) => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError('图片仅支持 PNG、JPEG、WebP');
    const dataUrl = await readDataUrl(file);
    setValue((current) => ({ ...current, assets: { ...current.assets, [state]: dataUrl } }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const input = {
      displayName: value.displayName,
      intro: value.intro,
      personalityTags: value.personalityTags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 3),
      personalityPrompt: value.personalityPrompt,
      selectedModelId: value.selectedModelId.trim() || null,
      assets: value.assets,
    };
    try {
      if (value.profileId) await updateCharacterProfile(value.profileId, input);
      else await createCharacterProfile(input);
      await onSaved();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="coming-soon-backdrop">
      <form className="coming-soon-dialog character-editor" role="dialog" aria-modal="true" aria-labelledby="character-editor-title" onSubmit={submit}>
        <header><div><p className="eyebrow">自建角色</p><h2 id="character-editor-title">{value.profileId ? '编辑角色' : '新建角色'}</h2></div><button className="icon-action" type="button" title="关闭" aria-label="关闭角色编辑" onClick={onClose}><X aria-hidden="true" /></button></header>
        <div className="character-editor__fields">
          <label><span>名称</span><input required maxLength={12} value={value.displayName} onChange={(event) => setValue({ ...value, displayName: event.target.value })} /></label>
          <label><span>简介</span><input maxLength={120} value={value.intro} onChange={(event) => setValue({ ...value, intro: event.target.value })} /></label>
          <label><span>性格标签</span><input maxLength={40} placeholder="最多 3 个，用逗号分隔" value={value.personalityTags} onChange={(event) => setValue({ ...value, personalityTags: event.target.value })} /></label>
          <label className="character-editor__wide"><span>Agent 人格</span><textarea maxLength={500} value={value.personalityPrompt} onChange={(event) => setValue({ ...value, personalityPrompt: event.target.value })} /></label>
          {providerMode !== 'fake' && <label className="character-editor__wide"><span>默认模型</span><input list="role-model-options" value={value.selectedModelId} onChange={(event) => setValue({ ...value, selectedModelId: event.target.value })} /></label>}
        </div>
        <fieldset className="character-editor__assets"><legend>角色素材</legend><div>{assetStates.map(([state, label]) => <label key={state}><span>{label}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={fileChanged(state)} /><b>{value.assets[state] ? '已选择' : value.profileId ? '保留原图' : '未选择'}</b></label>)}</div></fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="action-row"><button className="secondary-action" type="button" onClick={onClose}>取消</button><button className="primary-action" type="submit" disabled={saving}>{saving ? '保存中…' : '保存角色'}</button></div>
      </form>
    </div>
  );
}

function assetUrl(profile: CharacterProfile, state: CharacterAssetState) {
  const value = profile.assets[state];
  if (!value?.startsWith('builtin:')) return value ?? characterAvatars.deepseek;
  const profileId = value.slice('builtin:'.length).split('/')[0] as CharacterKey;
  return characterAvatars[profileId] ?? characterAvatars.deepseek;
}

function providerLabel(mode: CharacterProfileList['providerMode']) {
  if (mode === 'fake') return '内置假模型，无需联网';
  if (mode === 'openai-compatible') return '通用 OpenAI 兼容中转站';
  return '真实模型已接入';
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function messageFor(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return '无法连接本地服务';
}
