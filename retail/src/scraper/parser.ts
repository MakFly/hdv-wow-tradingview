import TurndownService from "turndown"

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
})

turndown.addRule("removeAds", {
  filter: (node) => {
    const el = node as HTMLElement
    return (
      el.classList?.contains("ad") ||
      el.classList?.contains("sidebar") ||
      el.classList?.contains("comments") ||
      el.id === "disqus_thread" ||
      el.tagName === "SCRIPT" ||
      el.tagName === "STYLE" ||
      el.tagName === "NAV"
    )
  },
  replacement: () => "",
})

turndown.addRule("cleanLinks", {
  filter: "a",
  replacement: (content, node) => {
    const el = node as HTMLAnchorElement
    const href = el.getAttribute("href") ?? ""
    if (href.startsWith("#") || href.startsWith("javascript:")) return content
    return `[${content}](${href})`
  },
})

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
