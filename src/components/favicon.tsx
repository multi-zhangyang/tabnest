import { useEffect, useMemo, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { brandOf } from "@/lib/brands"
import { domainOf } from "@/lib/bookmarks"
import { cn } from "@/lib/utils"

export function Favicon({
  url,
  label,
  className,
  online = false,
}: {
  url: string
  label?: string
  className?: string
  online?: boolean
}) {
  return (
    <SiteIcon
      key={`${url}:${online}`}
      url={url}
      label={label}
      className={className}
      online={online}
    />
  )
}

function SiteIcon({
  url,
  label,
  className,
  online,
}: {
  url: string
  label?: string
  className?: string
  online: boolean
}) {
  const sources = useMemo(() => {
    const result: string[] = []
    const brand = brandOf(url)
    if (brand.icon) result.push(brand.icon)
    if (globalThis.chrome?.runtime?.id) {
      const native = new URL(chrome.runtime.getURL("/_favicon/"))
      native.searchParams.set("pageUrl", url)
      native.searchParams.set("size", "128")
      result.push(native.href)
    }
    try {
      const parsed = new URL(url)
      if (online && ["http:", "https:"].includes(parsed.protocol))
        result.push(`${parsed.origin}/favicon.ico`)
    } catch {
      /* A letter is used for invalid bookmarks. */
    }
    return result
  }, [url, online])
  const [tier, setTier] = useState(0)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (loaded || tier >= sources.length) return
    const timer = setTimeout(() => setTier((current) => current + 1), 3500)
    return () => clearTimeout(timer)
  }, [loaded, tier, sources.length])
  return (
    <Avatar className={cn("site-icon", className)}>
      {sources[tier] && (
        <AvatarImage
          key={sources[tier]}
          src={sources[tier]}
          alt=""
          referrerPolicy="no-referrer"
          onLoadingStatusChange={(status) => {
            if (status === "loaded") setLoaded(true)
            if (status === "error") setTier((current) => current + 1)
          }}
        />
      )}
      <AvatarFallback>
        {(label || domainOf(url)).trim().slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
