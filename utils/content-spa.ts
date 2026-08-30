import puppeteer, { type Browser } from "puppeteer";

export async function getContentSPA(url: string, timeoutMs = 15000): Promise<string | undefined> {
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      // Esperar brevemente a que las peticiones iniciales del SPA se asienten
      await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(timeoutMs, 5000) }).catch(() => {});
    } catch (navError) {
      console.warn(`[SPA] Navigation warning for ${url}:`, (navError as Error)?.message || navError);
    }

    // Reintentar la lectura de contenido si la página disparó una redirección que destruyó el contexto de ejecución
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const html = await page.content();
        if (html && html.trim()) {
          return html;
        }
      } catch (err: unknown) {
        const message = (err as Error)?.message || "";
        if (message.includes("Execution context was destroyed") || message.includes("navigating")) {
          // Esperar a que la nueva navegación se complete antes del siguiente intento
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 3000 }).catch(() => {});
        } else if (attempt === 3) {
          console.error(`[SPA] Error getting content from ${url}:`, err);
        }
      }
    }
  } catch (error) {
    console.error(`[SPA] Failed to launch or process SPA for ${url}:`, error);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
