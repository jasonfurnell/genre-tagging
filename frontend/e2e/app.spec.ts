import { expect, test } from '@playwright/test'

test('app loads with heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('GenreTagging V2')).toBeVisible()
})
