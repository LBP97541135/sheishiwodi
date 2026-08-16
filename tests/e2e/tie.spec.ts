import { expect, test } from '@playwright/test';

import { createAndStartGame, playUntilTerminalOrSpectator } from './helpers';

test('一次平票后进入辩解和候选重投并产生淘汰', async ({ page }) => {
  await createAndStartGame(page, '平票流程');
  await playUntilTerminalOrSpectator(page);

  await expect(page.getByText('平票', { exact: true })).toBeVisible();
  await expect(page.getByText('重投', { exact: true })).toBeVisible();
  await expect(page.getByText(/被淘汰/).first()).toBeVisible();
});
