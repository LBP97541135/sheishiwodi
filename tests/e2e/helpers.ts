import { expect, type Page } from '@playwright/test';

export async function createAndStartGame(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('你的名字').fill(name);
  await page.getByRole('button', { name: '开始新对局' }).click();
  await expect(page.getByRole('heading', { name: '记住你的词牌' })).toBeVisible();
  await page.getByRole('button', { name: '我已记住，开始游戏' }).click();
  await expect(page.getByRole('heading', { name: /第 1 轮|对局结束/ })).toBeVisible();
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

    for (let step = 0; step < 80; step += 1) {
      const view = await getView();
      if (view.status === 'awaiting_spectator' || view.status === 'finished') return view.status;
      if (view.status !== 'in_progress') return view.status;
      if (view.round?.currentActorId !== view.human.playerId) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const envelope = {
        commandId: crypto.randomUUID(),
        actorId: view.human.playerId,
        expectedRevision: view.revision,
      };
      if (view.round.actionType === 'describe') {
        await post('descriptions', { ...envelope, text: `日常线索${step + 1}` });
      } else if (view.round.actionType === 'defend') {
        await post('defenses', { ...envelope, text: `线索一致${step + 1}` });
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
  for (let step = 0; step < 2; step += 1) {
    const newGameButton = page.getByRole('button', { name: '开始新对局' });
    if (await newGameButton.isVisible().catch(() => false)) {
      await newGameButton.click();
      break;
    }
    const gameId = await page.evaluate(() => localStorage.getItem('sheishiwodi:last-game-id'));
    if (!gameId) break;
    const status = await page.evaluate(async (id) => {
      const response = await fetch(`/api/games/${id}`);
      return (await response.json()).data.status as string;
    }, gameId);
    if (status === 'awaiting_spectator') {
      await page.evaluate(async (id) => {
        const view = await fetch(`/api/games/${id}`).then((response) => response.json()).then((body) => body.data);
        await fetch(`/api/games/${id}/abandon`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            actorId: view.human.playerId,
            expectedRevision: view.revision,
            confirmed: true,
          }),
        });
      }, gameId);
      await page.reload();
    }
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