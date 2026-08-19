import { useCallback, useEffect, useState } from 'react';

import type {
  DeveloperFullRecordDetail,
  DeveloperFullRecordSummary,
  DeveloperOverview,
} from '@sheishiwodi/shared';

import {
  ApiClientError,
  clearDeveloperFullRecords,
  getDeveloperFullRecord,
  getDeveloperFullRecords,
  getDeveloperOverview,
  setFullContextRecording,
} from '../api';

type Tab = 'calls' | 'contexts' | 'recovery' | 'review';

export function DeveloperPanel({ gameId, onBack }: { gameId?: string; onBack(): void }) {
  const [tab, setTab] = useState<Tab>('calls');
  const [overview, setOverview] = useState<DeveloperOverview | null>(null);
  const [records, setRecords] = useState<DeveloperFullRecordSummary[]>([]);
  const [detail, setDetail] = useState<DeveloperFullRecordDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await getDeveloperOverview(gameId);
      setOverview(next);
      setRecords(next.fullRecordingEnabled ? await getDeveloperFullRecords(gameId) : []);
      if (!next.fullRecordingEnabled) setDetail(null);
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setBusy(false);
    }
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFullRecording = async () => {
    if (!overview) return;
    const enabled = !overview.fullRecordingEnabled;
    if (
      enabled &&
      !window.confirm('完整上下文可能包含对局词牌和模型原文，仅用于本机调试。确认开启？')
    ) return;
    setBusy(true);
    setError(null);
    try {
      await setFullContextRecording(enabled);
      await refresh();
    } catch (toggleError) {
      setError(messageFor(toggleError));
      setBusy(false);
    }
  };

  const revealRecord = async (record: DeveloperFullRecordSummary) => {
    if (!window.confirm('即将显示该次调用的完整提示词和原始响应，确认继续？')) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await getDeveloperFullRecord(record.attemptId));
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setBusy(false);
    }
  };

  const clearRecords = async () => {
    if (!window.confirm('确认清除本机保存的全部完整上下文记录？')) return;
    setBusy(true);
    try {
      await clearDeveloperFullRecords();
      setRecords([]);
      setDetail(null);
    } catch (clearError) {
      setError(messageFor(clearError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="storyboard developer-panel" aria-labelledby="developer-title">
      <header className="developer-panel__header">
        <div>
          <p className="eyebrow">本机诊断</p>
          <h1 id="developer-title">Agent 观测面板</h1>
        </div>
        <div className="developer-panel__actions">
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void refresh()}>
            刷新
          </button>
          <button type="button" className="secondary-action" onClick={onBack}>返回对局</button>
        </div>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {!overview ? (
        <p className="lede">{busy ? '正在读取诊断数据…' : '暂无诊断数据。'}</p>
      ) : (
        <>
          <div className="developer-panel__sensitive-controls">
            <div>
              <strong>完整上下文记录</strong>
              <span>仅保存开启后的新调用，服务重启后自动关闭。</span>
            </div>
            <button
              type="button"
              className="utility-action"
              aria-pressed={overview.fullRecordingEnabled}
              disabled={busy}
              onClick={() => void toggleFullRecording()}
            >
              {overview.fullRecordingEnabled ? '停止记录' : '开启记录'}
            </button>
            {records.length > 0 && (
              <button type="button" className="secondary-action" disabled={busy} onClick={() => void clearRecords()}>
                清除完整记录
              </button>
            )}
          </div>

          <div className="developer-tabs" role="tablist" aria-label="诊断视图">
            <TabButton id="calls" current={tab} onSelect={setTab}>调用链</TabButton>
            <TabButton id="contexts" current={tab} onSelect={setTab}>上下文</TabButton>
            <TabButton id="recovery" current={tab} onSelect={setTab}>错误与恢复</TabButton>
            <TabButton id="review" current={tab} onSelect={setTab}>复盘调度</TabButton>
          </div>

          <div className="developer-panel__body" role="tabpanel">
            {tab === 'calls' && <CallsView overview={overview} />}
            {tab === 'contexts' && (
              <ContextsView overview={overview} records={records} onReveal={revealRecord} />
            )}
            {tab === 'recovery' && <RecoveryView overview={overview} />}
            {tab === 'review' && <ReviewView overview={overview} />}
          </div>
          {detail && <FullRecordDetail detail={detail} onClose={() => setDetail(null)} />}
        </>
      )}
    </section>
  );
}

function TabButton({ id, current, onSelect, children }: {
  id: Tab;
  current: Tab;
  onSelect(value: Tab): void;
  children: string;
}) {
  return (
    <button type="button" role="tab" aria-selected={current === id} onClick={() => onSelect(id)}>
      {children}
    </button>
  );
}

function CallsView({ overview }: { overview: DeveloperOverview }) {
  if (overview.calls.length === 0) return <Empty text="还没有模型调用记录。" />;
  return (
    <div className="developer-table-wrap">
      <table className="developer-table">
        <thead><tr><th>时间</th><th>角色</th><th>动作</th><th>模型</th><th>尝试</th><th>阶段</th><th>结果</th><th>耗时</th></tr></thead>
        <tbody>{overview.calls.map((call) => (
          <tr key={call.attemptId}>
            <td>{formatTime(call.startedAt)}</td><td>{call.roleId}</td><td>{call.actionType}</td>
            <td>{call.modelId}</td><td>{call.attemptNumber} / {call.attemptKind}</td>
            <td>{call.stages?.map((stage) => stage.stage).join(' → ') || '-'}</td>
            <td><code>{call.resultCode}</code></td><td>{call.durationMs === undefined ? '-' : `${call.durationMs} ms`}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ContextsView({ overview, records, onReveal }: {
  overview: DeveloperOverview;
  records: DeveloperFullRecordSummary[];
  onReveal(record: DeveloperFullRecordSummary): void;
}) {
  const recordByAttempt = new Map(records.map((record) => [record.attemptId, record]));
  if (overview.contexts.length === 0) return <Empty text="还没有上下文清单。" />;
  return <ul className="developer-list">{overview.contexts.map((context) => {
    const record = recordByAttempt.get(context.attemptId);
    return (
      <li key={context.attemptId}>
        <div><strong>{context.roleId} · {context.actionType}</strong><code>{context.promptHash.slice(0, 12)}</code></div>
        <p>{context.sources.map((source) => `${source.kind}:${source.visibility}(${source.itemCount})`).join(' · ')}</p>
        <small>{context.validationStatus} · cursor {context.publicEventCursor} · {context.templateVersion}</small>
        {record && <button type="button" className="secondary-action" onClick={() => void onReveal(record)}>查看完整记录</button>}
      </li>
    );
  })}</ul>;
}

function RecoveryView({ overview }: { overview: DeveloperOverview }) {
  const data = overview.errorsAndRecovery;
  return (
    <div className="developer-facts">
      <p><strong>Provider 熔断：</strong><code>{data.providerCircuit.state}</code></p>
      <p><strong>失败调用：</strong>{data.failedAttempts.length}</p>
      <p><strong>待确认中断对局：</strong>{data.interruptedGames.length}</p>
      {data.failedAttempts.map((attempt) => <code key={attempt.attemptId}>{attempt.roleId} / {attempt.actionType} / {attempt.resultCode}</code>)}
      {data.interruptedGames.map((entry) => <code key={entry.actionId}>{entry.gameId} / {entry.actionId}</code>)}
    </div>
  );
}

function ReviewView({ overview }: { overview: DeveloperOverview }) {
  const review = overview.review;
  return (
    <div className="developer-facts">
      <p><strong>正在执行：</strong>{review.runningGameId ?? '无'}</p>
      <p><strong>等待队列：</strong>{review.queuedGameIds.length ? review.queuedGameIds.join('、') : '空'}</p>
      <p><strong>被活动对局阻塞：</strong>{review.blockedByActiveGame ? '是' : '否'}</p>
      <p><strong>调度器已停止：</strong>{review.stopped ? '是' : '否'}</p>
    </div>
  );
}

function FullRecordDetail({ detail, onClose }: { detail: DeveloperFullRecordDetail; onClose(): void }) {
  return (
    <section className="developer-record" aria-label="完整上下文记录">
      <header><strong>{detail.actionType} · {detail.attemptId}</strong><button type="button" className="secondary-action" onClick={onClose}>关闭</button></header>
      <h2>提示词</h2>
      <pre>{JSON.stringify(detail.prompt, null, 2)}</pre>
      <h2>原始响应</h2>
      <pre>{detail.rawResponse ?? '尚无响应'}</pre>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="developer-empty">{text}</p>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour12: false });
}

function messageFor(error: unknown) {
  return error instanceof ApiClientError ? error.message : '无法读取开发者诊断数据';
}
