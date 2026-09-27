import { AppError } from "./errors"

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url
  } catch {
    return url
  }
}

export function normalizeUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new AppError("invalid-data", "请输入网址")
  try {
    const hasScheme =
      /^[a-z][a-z\d+.-]*:/i.test(value) &&
      !/^[^/:\s]+:\d+(?:[/?#]|$)/.test(value)
    const url = new URL(hasScheme ? value : `https://${value}`)
    if (!["https:", "http:", "ftp:", "chrome:", "edge:"].includes(url.protocol))
      throw new AppError("invalid-data", "不支持此网址协议")
    if (!url.hostname || /\s/.test(value) || value.length > 8192)
      throw new AppError("invalid-data", "网址格式不正确")
    return url.href
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError("invalid-data", "网址格式不正确", { cause })
  }
}

export function safeUrl(value: string): string | undefined {
  try {
    return normalizeUrl(value)
  } catch {
    return undefined
  }
}
