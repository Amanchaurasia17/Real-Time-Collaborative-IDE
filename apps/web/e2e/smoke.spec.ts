import { test, expect } from '@playwright/test';

test('has IDE elements loaded', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Realtime Collab Editor/);

  // Expect the Run Code button to be visible
  await expect(page.getByRole('button', { name: '▶ Run Code' })).toBeVisible();

  // Expect the Online users to load (sidebar)
  await expect(page.getByText('CONNECTION')).toBeVisible();
});

test('changes room when form submitted', async ({ page }) => {
  await page.goto('/');
  
  // Fill the room input and submit
  const input = page.locator('input');
  await input.fill('faang-interview-room');
  await page.getByRole('button', { name: 'Join' }).click();

  // Assert URL has changed
  await expect(page).toHaveURL(/room=faang-interview-room/);
  
  // Assert the room badge has updated
  await expect(page.getByText('room: faang-interview-room')).toBeVisible();
});
