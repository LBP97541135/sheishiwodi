import { expect, test } from '@playwright/test';

import {
  createAndStartGame,
  expectNoTerminalSecrets,
  finishCurrentTerminalAndStartNewGame,
  playUntilTerminalOrSpectator,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // 等待应用完成挂载再判断当前视图：顶部导航仅在 loadState 就绪后渲染，
  // 避免冷启动（首个用例）时 React 尚未挂载被误判为“无表单需清理”。
  await expect(page.getByRole('button', { name: '模型档案' })).toBeVisible();
  if (!(await page.getByLabel('你的名字').isVisible().catch(() => false))) {
    await finishCurrentTerminalAndStartNewGame(page);
  }
});

test('人类被淘汰后继续观战，公开视图不升级并自动到终局', async ({ page }) => {
  await createAndStartGame(page, '观战流程');
  expect(await playUntilTerminalOrSpectator(page)).toBe('awaiting_spectator');
  await expect(page.getByRole('button', { name: '继续观战' })).toBeVisible();
  await expect(page.getByRole('button', { name: '放弃本局' })).toBeVisible();
  await expectNoTerminalSecrets(page);
  await expect(page.locator('.finale-card')).toHaveCount(0);

  await page.getByRole('button', { name: '继续观战' }).click();
  await expect(page.getByRole('heading', { name: '对局结束' })).toBeVisible();
  await expect(page.locator('.finale-card[data-revealed="true"]')).toHaveCount(4);
});

test('人类被淘汰后放弃，保留不完整事实且无胜者', async ({ page }) => {
  await createAndStartGame(page, '观战放弃');
  expect(await playUntilTerminalOrSpectator(page)).toBe('awaiting_spectator');
  await page.getByRole('button', { name: '放弃本局' }).click();
  await expect(page.getByText('确认放弃本局？')).toBeVisible();
  await page.locator('.abandon-confirm').getByRole('button', { name: '放弃本局' }).click();
  await expect(page.getByText('本局已放弃', { exact: true })).toBeVisible();
  await expect(page.getByText(/平民胜利|卧底胜利/)).toHaveCount(0);
  await expectNoTerminalSecrets(page);
});
