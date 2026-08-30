export async function isSPA(html: string): Promise<boolean> {
  // Señales fuertes de SPA pura
  const strongSignals = [
    /<div\s+id=["']root["']>\s*<\/div>/i,
    /<div\s+id=["']app["']>\s*<\/div>/i,
    /You need to enable JavaScript/i,
  ];

  // Si el body tiene menos de 500 caracteres de texto real
  const bodyText = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || "")
    .replace(/<[^>]+>/g, "").trim();

  const hasStrongSignal = strongSignals.some(r => r.test(html));
  const hasMinimalContent = bodyText.length < 500;

  return hasStrongSignal || hasMinimalContent;
}

export function detectWebAppType(html: string) {
  const analysis = {
    isSPA: false,
    hasSSR: false,
    framework: null as string | null,
    confidence: 0,
    signals: [] as string[],
    bodyTextLength: 0,
    scriptCount: 0,
  };

  // 1. Extraer el contenido del <body>
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : "";

  // Quitar tags para contar solo texto real
  const textOnly = bodyContent.replace(/<[^>]+>/g, "").trim();
  analysis.bodyTextLength = textOnly.length;

  // 2. Contar scripts
  const scripts = html.match(/<script[^>]*src="([^"]*)"[^>]*>/gi) || [];
  analysis.scriptCount = scripts.length;

  // 3. Detectar frameworks
  const frameworks: Record<string, RegExp> = {
    "React": /react(\.production|\.development)?\.js|__NEXT_DATA__|_next\/static/i,
    "Vue": /vue(\.min)?\.js|__NUXT__|nuxt/i,
    "Angular": /angular|ng-version|zone\.js/i,
    "Svelte": /svelte/i,
    "Next.js": /_next\/static|__NEXT_DATA__|next\/dist/i,
    "Nuxt": /_nuxt\/|__NUXT__/i,
    "Remix": /remix|__remix/i,
    "Astro": /astro-island|astro:i-fragment/i,
    "Gatsby": /gatsby/i,
  };

  for (const [name, regex] of Object.entries(frameworks)) {
    if (regex.test(html)) {
      analysis.framework = name;
      analysis.signals.push(`Framework detectado: ${name}`);
      break;
    }
  }

  // 4. Señales de SPA pura (sin SSR)
  const spaSignals = [
    { test: /<div\s+id=["']root["']>\s*<\/div>/i, msg: "Div root vacío (React típico)" },
    { test: /<div\s+id=["']app["']>\s*<\/div>/i, msg: "Div app vacío (Vue típico)" },
    { test: /<div\s+id=["']__next["']>\s*<\/div>/i, msg: "Div __next vacío (Next.js sin SSR)" },
    { test: /<noscript>You need to enable JavaScript/i, msg: "Mensaje 'enable JavaScript'" },
  ];

  for (const signal of spaSignals) {
    if (signal.test.test(html)) {
      analysis.signals.push(signal.msg);
      analysis.isSPA = true;
    }
  }

  // 5. Señales de SSR (contenido renderizado en servidor)
  if (analysis.bodyTextLength > 500 && analysis.framework) {
    analysis.hasSSR = true;
    analysis.signals.push("Contenido renderizado en servidor (SSR)");
  }

  // 6. Calcular confianza
  let confidence = 0;
  if (analysis.framework) confidence += 40;
  if (analysis.bodyTextLength < 200) confidence += 30;
  if (analysis.isSPA) confidence += 20;
  if (scripts.length > 3) confidence += 10;
  analysis.confidence = Math.min(confidence, 100);

  // 7. Determinar tipo final
  if (analysis.hasSSR) {
    analysis.isSPA = false; // Tiene SSR, fetch() funcionará
  } else if (analysis.confidence > 50) {
    analysis.isSPA = true;
  }

  return analysis;
}
