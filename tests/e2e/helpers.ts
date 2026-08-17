import { expect, type Page } from '@playwright/test';

export async function createAndStartGame(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('你的名字').fill(name);
  await page.getByRole('button', { name: '经典模式' }).click();
  await expect(page.getByRole('heading', { name: '记住你的词牌' })).toBeVisible();
  const startButton = page.getByRole('button', { name: '我已记住，开始游戏' });
  const startedHeading = page.getByRole('heading', { name: /第 1 轮|对局结束/ });
  // 极少数情况下首次点击会在 busy 尚未落定或事件句柄尚未就绪时被吞掉，
  // 导致对局停留在准备阶段。这里重试点击“开始游戏”，直到进入对局界面。
  await expect(async () => {
    if (await startButton.isVisible().catch(() => false)) {
      await startButton.click();
    }
    await expect(startedHeading).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

export async function playUntilTerminalOrSpectator(page: Page) {
  const status = await page.evaluate(async () => {
    const gameId = localStorage.getItem('sheishiwodi:last-game-id');
    if (!gameId) throw new Error('缺少当前对局 ID');

    const getView = async () => {
      const response = await fetch(`/api/games/${gameId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.data;
    };
    const post = async (path: string, payload: Record<string, unknown>) => {
      const response = await fetch(`/api/games/${gameId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.data;
    };

    // 运行时后台推进 AI 回合：人类命令提交后立即返回、AI 回合异步跑，
    // 因此本轮询循环会在“当前是 AI 行动者”时自旋等待（sleep+continue）。
    // 用挂钟截止时间兜底，避免把 AI 回合的自旋计入固定步数预算而误判超时；
    // 人类动作用独立计数器命名，另设一个很宽松的迭代上限防真正卡死时死循环。
    const deadline = Date.now() + 60_000;
    let humanActions = 0;
    for (let iteration = 0; iteration < 5000; iteration += 1) {
      if (Date.now() > deadline) {
        throw new Error('对局未在限定时间内到达等待观战或终局');
      }
      const view = await getView();
      if (view.status === 'awaiting_spectator' || view.status === 'finished') return view.status;
      if (view.status !== 'in_progress') return view.status;
      if (view.round?.currentActorId !== view.human.playerId) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      humanActions += 1;
      const envelope = {
        commandId: crypto.randomUUID(),
        actorId: view.human.playerId,
        expectedRevision: view.revision,
      };
      if (view.round.actionType === 'describe') {
        await post('descriptions', { ...envelope, text: `日常线索${humanActions}` });
      } else if (view.round.actionType === 'defend') {
        await post('defenses', { ...envelope, text: `线索一致${humanActions}` });
      } else {
        await post('votes', { ...envelope, targetPlayerId: view.legalVoteTargetIds[0] });
      }
    }
    throw new Error('对局未在限定步数内到达等待观战或终局');
  });

  await page.reload();
  return status as 'awaiting_spectator' | 'finished' | 'abandoned';
}

export async function finishCurrentTerminalAndStartNewGame(page: Page) {
  // 优先走终局的“开始新对局”按钮；若当前是仍在进行/准备/等待观战的活动局，
  // 则直接放弃它，保证跨用例的对局隔离（共享 SQLite 下前一用例的残留不会污染后续）。
  const newGameButton = page.getByRole('button', { name: '开始新对局' });
  if (await newGameButton.isVisible().catch(() => false)) {
    await newGameButton.click();
  } else {
    await page.evaluate(async () => {
      const readView = async (id: string) =>
        fetch(`/api/games/${id}`).then((response) => response.json()).then((body) => body.data);
      const active = await fetch('/api/games/active')
        .then((response) => response.json())
        .then((body) => body.data?.game ?? null);
      let target = active;
      if (!target) {
        const id = localStorage.getItem('sheishiwodi:last-game-id');
        target = id ? await readView(id) : null;
      }
      if (target && ['preparing', 'in_progress', 'awaiting_spectator'].includes(target.status)) {
        await fetch(`/api/games/${target.gameId}/abandon`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            actorId: target.human.playerId,
            expectedRevision: target.revision,
            confirmed: true,
          }),
        });
      }
    });
  }
  await page.evaluate(() => localStorage.removeItem('sheishiwodi:last-game-id'));
  await page.reload();
  await expect(page.getByLabel('你的名字')).toBeVisible();
}

export async function expectNoTerminalSecrets(page: Page) {
  const [html, rawView] = await Promise.all([
    page.locator('body').innerHTML(),
    page.evaluate(async () => {
      const gameId = localStorage.getItem('sheishiwodi:last-game-id');
      if (!gameId) return '';
      return fetch(`/api/games/${gameId}`).then((response) => response.text());
    }),
  ]);
  for (const serialized of [html, rawView]) {
    expect(serialized).not.toContain('factReview');
    expect(serialized).not.toContain('reasoningSummary');
    expect(serialized).not.toContain('undercoverWord');
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('"winnerCamp"');
    expect(serialized).not.toContain('"reveal"');
  }
}
