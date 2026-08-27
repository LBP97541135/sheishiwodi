import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Bot, Settings2, UserRound, Users } from 'lucide-react';

import type { CharacterProfile, CharacterProfileList, CreateGameRequest } from '@sheishiwodi/shared';

import { getCharacterProfiles } from '../api';
import { characterAssets, characterAvatars, type CharacterKey } from '../character-assets';

interface NewGameFormProps {
  busy: boolean;
  profileRevision: number;
  onCreate(input: CreateGameRequest): Promise<void>;
  onOpenRoleLibrary(): void;
}

export function NewGameForm({ busy, profileRevision, onCreate, onOpenRoleLibrary }: NewGameFormProps) {
  const [displayName, setDisplayName] = useState('');
  const [silhouette, setSilhouette] = useState<'silhouette_a' | 'silhouette_b'>('silhouette_a');
  const [humanRoleId, setHumanRoleId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'hard'>('easy');
  const [participationMode, setParticipationMode] = useState<'human' | 'observer'>('human');
  const [totalPlayers, setTotalPlayers] = useState(4);
  const [requestBudget, setRequestBudget] = useState(80);
  const [gameMode, setGameMode] = useState<'classic' | 'guess'>('classic');
  const [profiles, setProfiles] = useState<CharacterProfileList | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [configuring, setConfiguring] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [silhouetteDraft, setSilhouetteDraft] = useState<'silhouette_a' | 'silhouette_b'>('silhouette_a');
  const [humanRoleDraft, setHumanRoleDraft] = useState<string | null>(null);
  const nameTriggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getCharacterProfiles().then(setProfiles).catch(() => setValidation('角色库暂时无法读取'));
  }, [profileRevision]);

  const selectableProfiles = useMemo(
    () => profiles?.profiles.filter((profile) =>
      profile.complete &&
      profile.allowedParticipantKinds.includes('agent') &&
      (profiles.providerMode === 'fake' || Boolean(profile.selectedModelId))) ?? [],
    [profiles],
  );
  const eligibleProfiles = useMemo(
    () => selectableProfiles.filter((profile) =>
      participationMode !== 'human' || profile.profileId !== humanRoleId,
    ),
    [humanRoleId, participationMode, selectableProfiles],
  );
  const selectedHumanRole = selectableProfiles.find((profile) => profile.profileId === humanRoleId);
  const agentCount = totalPlayers - (participationMode === 'human' ? 1 : 0);

  useEffect(() => {
    setSelectedRoleIds((current) => {
      const kept = current.filter((id) => eligibleProfiles.some((profile) => profile.profileId === id));
      const next = kept.slice(0, agentCount);
      for (const profile of eligibleProfiles) {
        if (next.length >= agentCount) break;
        if (!next.includes(profile.profileId)) next.push(profile.profileId);
      }
      return next;
    });
    if (profiles?.providerMode !== 'fake' && participationMode === 'observer') {
      setRequestBudget((current) => Math.max(current, totalPlayers * 20));
    }
  }, [agentCount, eligibleProfiles, participationMode, profiles?.providerMode, totalPlayers]);

  const closeNameDialog = useCallback(() => {
    setNameDialogOpen(false);
    nameTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!nameDialogOpen) return;
    if (humanRoleDraft === null) nameInputRef.current?.focus();
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && closeNameDialog();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [closeNameDialog, humanRoleDraft, nameDialogOpen]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedRoleIds.length !== agentCount) {
      setValidation(`当前只有 ${eligibleProfiles.length} 个可用 AI 角色，请先补齐角色库`);
      return;
    }
    setValidation(null);
    void onCreate({
      commandId: crypto.randomUUID(),
      gameMode,
      participationMode,
      human: selectedHumanRole
        ? { roleId: selectedHumanRole.profileId }
        : { displayName: displayName.trim() || '玩家', silhouette },
      agentRoleIds: selectedRoleIds,
      difficulty,
      ...(profiles?.providerMode !== 'fake' && participationMode === 'observer' ? { requestBudget } : {}),
    });
  };

  if (configuring) {
    return (
      <form className="new-game game-config" onSubmit={submit}>
        <header className="game-config__header">
          <button className="icon-action" type="button" title="返回模式选择" aria-label="返回模式选择" onClick={() => setConfiguring(false)}><ArrowLeft aria-hidden="true" /></button>
          <div><p className="eyebrow">{gameMode === 'guess' ? '猜词模式' : '经典模式'}</p><h1>配置本局阵容</h1></div>
          <span className="rule-stamp">{totalPlayers >= 6 ? 2 : 1} 名卧底</span>
        </header>

        <div className="game-config__grid">
          <fieldset className="config-section">
            <legend>参与方式</legend>
            <div className="segmented-control">
              <label><input type="radio" name="participation" checked={participationMode === 'human'} onChange={() => setParticipationMode('human')} /><UserRound aria-hidden="true" />亲自参与</label>
              <label><input type="radio" name="participation" checked={participationMode === 'observer'} onChange={() => setParticipationMode('observer')} /><Bot aria-hidden="true" />Agent 对局</label>
            </div>
          </fieldset>

          <fieldset className="config-section">
            <legend>总玩家数</legend>
            <div className="player-count-control">
              {[4, 5, 6, 7, 8].map((count) => <button key={count} type="button" className={totalPlayers === count ? 'is-active' : ''} aria-pressed={totalPlayers === count} onClick={() => setTotalPlayers(count)}>{count}</button>)}
            </div>
          </fieldset>

          <fieldset className="config-section config-section--roster">
            <legend><Users aria-hidden="true" />AI 阵容</legend>
            <div className="roster-selects">
              {Array.from({ length: agentCount }, (_, index) => (
                <label key={index}>
                  <span>席位 {index + 1 + (participationMode === 'human' ? 1 : 0)}</span>
                  <select value={selectedRoleIds[index] ?? ''} onChange={(event) => setSelectedRoleIds((current) => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })}>
                    <option value="">选择角色</option>
                    {eligibleProfiles.map((profile) => (
                      <option key={profile.profileId} value={profile.profileId} disabled={selectedRoleIds.some((id, seat) => seat !== index && id === profile.profileId)}>{profile.displayName}{profile.source === 'custom' ? ' · 自建' : ''}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {eligibleProfiles.length < agentCount && <button className="text-action" type="button" onClick={onOpenRoleLibrary}>前往角色库补齐角色</button>}
          </fieldset>

          <fieldset className="config-section">
            <legend>词语难度</legend>
            <div className="segmented-control">
              <label><input type="radio" name="difficulty" checked={difficulty === 'easy'} onChange={() => setDifficulty('easy')} />简单</label>
              <label><input type="radio" name="difficulty" checked={difficulty === 'hard'} onChange={() => setDifficulty('hard')} />困难</label>
            </div>
          </fieldset>

          {profiles?.providerMode !== 'fake' && participationMode === 'observer' && (
            <label className="config-section budget-field"><span>真实请求预算</span><input type="number" min={1} max={500} value={requestBudget} onChange={(event) => setRequestBudget(Number(event.target.value))} /></label>
          )}
        </div>
        {validation && <p className="form-error" role="alert">{validation}</p>}
        <button className="primary-action game-config__start" type="submit" disabled={busy || !profiles}>{busy ? '正在创建…' : '创建对局'}</button>
      </form>
    );
  }

  return (
    <section className="new-game">
      <header className="new-game__header">
        <p className="eyebrow">AI 多角色推理对局</p>
        <h1 aria-label="谁是卧底">
          <button ref={nameTriggerRef} className="title-name-trigger" type="button" aria-haspopup="dialog" aria-label={selectedHumanRole ? `编辑玩家身份，当前角色为${selectedHumanRole.displayName}` : `编辑玩家身份，当前名称为${displayName.trim() || '玩家'}`} onClick={() => {
            setNameDraft(displayName);
            setSilhouetteDraft(silhouette);
            setHumanRoleDraft(humanRoleId);
            setNameDialogOpen(true);
          }}>谁</button><span>是卧底</span>
        </h1>
      </header>
      <div className="game-mode-actions" role="group" aria-label="选择游戏模式">
        <button className="primary-action game-mode-actions__classic" type="button" disabled={busy} onClick={() => { setGameMode('classic'); setConfiguring(true); }}><strong>经典模式</strong><span aria-hidden="true">开始配置</span></button>
        <button className="secondary-action game-mode-actions__guess" type="button" disabled={busy} onClick={() => { setGameMode('guess'); setConfiguring(true); }}>猜词模式</button>
      </div>

      {nameDialogOpen && (
        <div className="coming-soon-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeNameDialog()}>
          <section className="coming-soon-dialog player-name-dialog" role="dialog" aria-modal="true" aria-labelledby="player-identity-title">
            <p className="eyebrow">玩家身份</p><h2 id="player-identity-title">编辑玩家身份</h2>
            {humanRoleDraft === null
              ? <label className="field"><span>玩家名称</span><input ref={nameInputRef} value={nameDraft} maxLength={12} onChange={(event) => setNameDraft(event.target.value)} /></label>
              : <p className="player-name-dialog__possession">你将使用该角色的名称与形象亲自参与；该角色不会再出现在 AI 阵容中，也不会替你调用模型。</p>}
            <fieldset className="player-name-dialog__appearance">
              <legend>玩家形象</legend>
              <div className="choice-grid choice-grid--silhouette">
                {([['silhouette_a', '男性', characterAssets['human-male'].idle], ['silhouette_b', '女性', characterAssets['human-female'].idle]] as const).map(([value, label, image]) => (
                  <label className="choice-card choice-card--portrait" key={value}><input type="radio" name="player-identity" checked={humanRoleDraft === null && silhouetteDraft === value} onChange={() => { setHumanRoleDraft(null); setSilhouetteDraft(value); }} /><img className="choice-portrait" src={image} alt="" /><strong>{label}</strong></label>
                ))}
                {selectableProfiles.map((profile) => (
                  <label className="choice-card choice-card--portrait" key={profile.profileId}><input type="radio" name="player-identity" checked={humanRoleDraft === profile.profileId} onChange={() => setHumanRoleDraft(profile.profileId)} /><img className="choice-portrait" src={profileAvatar(profile)} alt="" /><strong>{profile.displayName}</strong></label>
                ))}
              </div>
            </fieldset>
            <div className="player-name-dialog__actions">
              <button className="secondary-action" type="button" onClick={closeNameDialog}>取消</button>
              <button className="primary-action" type="button" onClick={() => {
                setDisplayName(nameDraft.trim());
                setSilhouette(silhouetteDraft);
                setHumanRoleId(humanRoleDraft);
                closeNameDialog();
              }}><Settings2 aria-hidden="true" />保存身份</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function profileAvatar(profile: CharacterProfile) {
  const value = profile.assets.avatar;
  if (!value?.startsWith('builtin:')) return value ?? characterAvatars.deepseek;
  const profileId = value.slice('builtin:'.length).split('/')[0] as CharacterKey;
  return characterAvatars[profileId] ?? characterAvatars.deepseek;
}
