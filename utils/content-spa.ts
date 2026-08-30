import puppeteer from "puppeteer";

export async function getContentSPA(url: string) {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "networkidle2", // Espera a que no haya más peticiones de red
    });

    // HTML completo renderizado
    const html = await page.content();

    await browser.close();

    return html;
  } catch (error) {
    console.error(error);
  }
}
