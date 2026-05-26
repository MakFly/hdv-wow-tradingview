import { chromium, type Browser, type Page } from "playwright"

let browser: Browser | null = null

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser
  browser = await chromium.launch({ headless: true })
  return browser
}

export async function newPage(): Promise<Page> {
  const b = await getBrowser()
  const ctx = await b.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "fr-FR",
  })
  return ctx.newPage()
}

export async function closeBrowser() {
  if (browser) {
    await browser.close()
    browser = null
  }
}
