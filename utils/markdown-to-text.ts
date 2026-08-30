export interface MarkdownToTextOptions {
  preserveLinks?: boolean;      // true → muestra URL, false → solo texto
  preserveImages?: boolean;     // true → muestra alt text
  preserveCodeBlocks?: boolean; // true → mantiene el código
  preserveLists?: boolean;      // true → mantiene items sin marcadores
  preserveHeadings?: boolean;   // true → mantiene el texto de encabezados
  preserveBlockquotes?: boolean; // true → mantiene el texto de citas
  preserveTables?: boolean;     // true → convierte tablas a texto legible
}

export function markdownToText(md: string, options: MarkdownToTextOptions = {}): string {
  const opts: MarkdownToTextOptions = {
    preserveLinks: false,
    preserveImages: true,
    preserveCodeBlocks: true,
    preserveLists: true,
    preserveHeadings: true,
    preserveBlockquotes: true,
    preserveTables: false,
    ...options,
  };

  let text = md;

  // 1. Eliminar comentarios HTML
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Eliminar imágenes (con o sin alt)
  if (!opts.preserveImages) {
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");
  } else {
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  }

  // 3. Convertir enlaces
  if (opts.preserveLinks) {
    // [texto](url) → texto (url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  } else {
    // [texto](url) → texto
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }

  // 4. Eliminar referencias de enlaces: [1]: url
  text = text.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "");

  // 5. Eliminar bloques de código
  if (!opts.preserveCodeBlocks) {
    text = text.replace(/```[\s\S]*?```/g, "");
  } else {
    // Solo quitar los delimitadores, mantener el contenido
    text = text.replace(/```\w*\n?/g, "");
  }

  // 6. Eliminar código inline: `code` → code
  text = text.replace(/`([^`]+)`/g, "$1");

  // 7. Eliminar negrita y cursiva
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2"); // negrita
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");    // cursiva
  text = text.replace(/~~(.*?)~~/g, "$1");        // tachado

  // 8. Eliminar encabezados (mantener texto)
  if (opts.preserveHeadings) {
    text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  } else {
    text = text.replace(/^#{1,6}\s+.+$/gm, "");
  }

  // 9. Eliminar citas (mantener texto)
  if (opts.preserveBlockquotes) {
    text = text.replace(/^>\s?(.+)$/gm, "$1");
  } else {
    text = text.replace(/^>.*$/gm, "");
  }

  // 10. Convertir listas (mantener items)
  if (opts.preserveLists) {
    text = text.replace(/^[\s]*[-*+]\s+(.+)$/gm, "• $1");
    text = text.replace(/^[\s]*\d+\.\s+(.+)$/gm, "$1");
  } else {
    text = text.replace(/^[\s]*[-*+]\s+.+$/gm, "");
    text = text.replace(/^[\s]*\d+\.\s+.+$/gm, "");
  }

  // 11. Eliminar tablas
  if (!opts.preserveTables) {
    text = text.replace(/^\|.*\|$/gm, "");
    text = text.replace(/^\|?[-:\s|]+\|?$/gm, "");
  } else {
    // Convertir tablas a texto simple
    text = text.replace(/^\|(.+)\|$/gm, (_, content) => {
      return content.split("|").map((c: string) => c.trim()).join(" - ");
    });
    text = text.replace(/^\|?[-:\s|]+\|?$/gm, "");
  }

  // 12. Eliminar separadores horizontales
  text = text.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, "");

  // 13. Eliminar etiquetas HTML restantes
  text = text.replace(/<[^>]+>/g, "");

  // 14. Decodificar entidades HTML básicas
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 15. Limpiar espacios y líneas vacías
  text = text
    .replace(/[ \t]+$/gm, "")          // espacios al final de línea
    .replace(/\n{3,}/g, "\n\n")        // múltiples líneas vacías
    .replace(/^\s*\n/gm, "")           // líneas solo con espacios
    .trim();

  return text;
}
