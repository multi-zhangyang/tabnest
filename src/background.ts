import { bumpClick } from "./lib/preferences"
import { recordRecent } from "./lib/recent"
import { safeUrl } from "./lib/urls"

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.type !== "record-open" ||
    !safeUrl(message.url)
  )
    return
  void recordRecent(message.url).catch(() => {})
  void bumpClick(message.url).then(
    () => respond({ ok: true }),
    () => respond({ ok: false })
  )
  return true
})
