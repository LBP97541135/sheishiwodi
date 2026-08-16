import { expect, test } from '@playwright/test';

import { createAndStartGame, expectNoTerminalSecrets, playUntilTerminalOrSpectator } from './helpers';

test('正常完整对局、进行中刷新、终局揭晓与恢复', async ({ page }) => {
  await createAndStartGame(page, '正常流程');
  await expectNoTerminalSecrets(page);

  const heading = await page.getByRole('heading', { name: /第 \d+ 轮/ }).textContent();
  const panelsBefore = await page.locator('.comic-timeline > li').count();
  await page.reload();
  await expect(page.getByRole('heading', { name: heading ?? '' })).toBeVisible();
  expect(await page.locator('.comic-timeline > li').count()).toBe(panelsBefore);
  await expectNoTerminalSecrets(page);

  expect(await playUntilTerminalOrSpectator(page)).toBe('finished');
  await expect(page.getByText('平民胜利')).toBeVisible();
  await expect(page.locator('.finale-card[data-revealed="true"]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '查看事实复盘' })).toBeVisible();
  await page.getByRole('button', { name: '查看事实复盘' }).click();
  await expect(page.getByRole('heading', { name: '确定性事实复盘' })).toBeVisible();

  const revealedCards = await page.locator('.finale-card').allTextContents();
  await page.reload();
  await expect(page.getByRole('heading', { name: '对局结束' })).toBeVisible();
  await expect(page.locator('.finale-card')).toHaveCount(4);
  await expect(page.locator('.finale-card[data-revealed="true"]')).toHaveCount(4);
  expect(await page.locator('.finale-card').allTextContents()).toEqual(revealedCards);
});

test('进行中二次确认放弃且无阵营胜者', async ({ page }) => {
  await createAndStartGame(page, '放弃流程');
  await page.getByRole('button', { name: '放弃本局' }).click();
  await expect(page.getByText('确认放弃本局？')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('确认放弃本局？')).toBeHidden();

  await page.getByRole('button', { name: '放弃本局' }).click();
  await page.locator('.abandon-confirm').getByRole('button', { name: '放弃本局' }).click();
  await expect(page.getByText('本局已放弃', { exact: true })).toBeVisible();
  await expect(page.getByText('本局不会产生阵营胜负，已保留截至放弃时的不完整记录。')).toBeVisible();
  await expect(page.getByText(/平民胜利|卧底胜利/)).toHaveCount(0);
  await expectNoTerminalSecrets(page);
});
