async (page) => {
  await page.reload();
  await page.waitForTimeout(2200);
  const before = await page.evaluate(() => JSON.stringify({ muted: document.getElementById("hudAudio").hidden }));
  // Клик по телу — реальный пользовательский жест: должен разблокировать звук
  await page.mouse.click(400, 500);
  await page.waitForTimeout(400);
  const afterClick = await page.evaluate(
    () => JSON.stringify({ muted: document.getElementById("hudAudio").hidden }),
  );
  return "before=" + before + " afterClick=" + afterClick;
}
