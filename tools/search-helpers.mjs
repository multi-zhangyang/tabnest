export async function openSearch(page, query = "") {
  if (!(await page.$(".search-dialog")))
    await page.locator('[aria-label="打开搜索"]').click()
  await page.waitForSelector('[aria-label="搜索书签"]')
  await page.locator('[aria-label="搜索书签"]').fill(query)
  await page.waitForFunction(
    () =>
      document
        .querySelector(".search-command-list")
        ?.getAttribute("aria-busy") === "false"
  )
}
export async function showSearchResults(page, query) {
  await openSearch(page, query)
  await page.waitForSelector('.search-dialog [data-value="all-results"]')
  await page.locator('.search-dialog [data-value="all-results"]').click()
  await page.waitForSelector(".search-results")
}
export async function clearSearch(page) {
  if (await page.$(".search-dialog")) await page.keyboard.press("Escape")
  const clear = await page.$('[aria-label="清空搜索"]')
  if (clear) await clear.click()
}
