import TurndownService from "turndown";

export function removeStyles(html: string): string {
  return html
    // Eliminar etiquetas <style> completas (incluye multi-línea)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Eliminar atributos style="..."
    .replace(/\s+style="[^"]*"/gi, "")
    // Eliminar atributos style='...'
    .replace(/\s+style='[^']*'/gi, "")
    // Eliminar atributos class (opcional)
    .replace(/\s+class="[^"]*"/gi, "")
    // Limpiar atributos vacíos que quedaron
    .replace(/\s+(class|style)=/gi, "");
}

export function removeScripts(html: string): string {
  return html
    // Eliminar etiquetas <script> completas (incluye multi-línea)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // Eliminar eventos inline (onclick, onerror, onload, etc.)
    .replace(/\s+on\w+="[^"]*"/gi, "")
    .replace(/\s+on\w+='[^']*'/gi, "")
    // Eliminar href="javascript:..." (también es código ejecutable)
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
}

export function cleanMarkdown(md: string): string {
  return md
    // 1. Quitar enlaces vacíos: [](/), [](), [](url), [ ](/)
    .replace(/\[\s*\]\([^)]*\)/g, "")

    // 2. Quitar imágenes vacías: ![](/), ![](), ![](url)
    .replace(/!\[\s*\]\([^)]*\)/g, "")

    // 3. Quitar enlaces con texto pero URL vacía: [texto](), [texto](/)
    .replace(/\[([^\]]+)\]\(\s*\/?\s*\)/g, "$1")

    // 4. Quitar imágenes con alt pero URL vacía: ![alt](), ![alt](/)
    .replace(/!\[([^\]]*)\]\(\s*\/?\s*\)/g, "")

    // 5. Quitar líneas completamente vacías (más de 2 seguidas)
    .replace(/\n{3,}/g, "\n\n")

    // 6. Quitar espacios en blanco al final de cada línea
    .replace(/[ \t]+$/gm, "")

    // 7. Quitar encabezados vacíos: ## , ### , etc.
    .replace(/^#{1,6}\s*$/gm, "")

    // 8. Quitar listas vacías: - , * , 1.
    .replace(/^[\s]*[-*+]\s*$/gm, "")
    .replace(/^[\s]*\d+\.\s*$/gm, "")

    // 9. Quitar separadores huérfanos: ---, ***, ___
    .replace(/^[\s]*[-*_]{3,}\s*$/gm, "")

    // 10. Quitar bloques de código vacíos
    .replace(/```\w*\n\n```/g, "")

    // 11. Quitar citas vacías: > , > >
    .replace(/^[\s]*>+\s*$/gm, "")

    // 12. Quitar HTML vacío o comentarios HTML
    .replace(/<!--[\s\S]*?-->/g, "")

    // 13. Limpiar espacios múltiples
    .replace(/ {2,}/g, " ")

    // 14. Trim final
    .trim();
}

export function htmlToMarkdown(html: string) {
  try {
    const turndownService = new TurndownService();

    return turndownService.turndown(removeStyles(removeScripts(html)));
  } catch (error) {
    console.error(error);
  }
}
