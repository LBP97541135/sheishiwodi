import { expect, test, type Locator } from '@playwright/test';

import {
  createAndStartGame,
  expectNoTerminalSecrets,
  finishCurrentTerminalAndStartNewGame,
  playUntilTerminalOrSpectator,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // 等待应用完成挂载再判断当前视图，避免冷启动时把尚未渲染的首页
  // 误判为需要清理的上一局。
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  if (!(await page.getByRole('group', { name: '选择游戏模式' }).isVisible().catch(() => false))) {
    await finishCurrentTerminalAndStartNewGame(page);
  }
});

async function activateAction(button: Locator, mobile: boolean) {
  await expect(button).toBeVisible();
  const hitTestable = await button.evaluate(async (element) => {
    element.scrollIntoView({ block: 'center' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return hit === element || element.contains(hit);
  });
  expect(hitTestable).toBe(true);
  if (mobile) await button.tap({ force: true });
  else await button.click();
}

test('人类被淘汰后继续观战，公开视图不升级并自动到终局', async ({ page }, testInfo) => {
  await createAndStartGame(page, '观战流程');
  expect(await playUntilTerminalOrSpectator(page)).toBe('awaiting_spectator');
  await expect(page.getByRole('button', { name: '继续观战' })).toBeVisible();
  await expect(page.getByRole('button', { name: '放弃本局' })).toBeVisible();
  await expectNoTerminalSecrets(page);
  await expect(page.locator('.finale-card')).toHaveCount(0);

  const spectateButton = page.getByRole('button', { name: '继续观战' });
  await activateAction(spectateButton, testInfo.project.name.endsWith('-mobile'));
  await expect(page.getByRole('heading', { name: '对局结束' })).toBeVisible();
  await expect(page.locator('.finale-card[data-revealed="true"]')).toHaveCount(4);
});

test('人类被淘汰后放弃，保留不完整事实且无胜者', async ({ page }, testInfo) => {
  await createAndStartGame(page, '观战放弃');
  expect(await playUntilTerminalOrSpectator(page)).toBe('awaiting_spectator');
  const mobile = testInfo.project.name.endsWith('-mobile');
  await activateAction(page.getByRole('button', { name: '放弃本局' }), mobile);
  await expect(page.getByText('确认放弃本局？')).toBeVisible();
  await activateAction(page.locator('.abandon-confirm').getByRole('button', { name: '放弃本局' }), mobile);
  await expect(page.getByText('本局已放弃', { exact: true })).toBeVisible();
  await expect(page.getByText(/平民胜利|卧底胜利/)).toHaveCount(0);
  await expectNoTerminalSecrets(page);
});
