export function removeThinkTags(text: string): string {
  return text
    // 1. Quitar bloques <think>...</think> completos (multi-línea)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")

    // 2. Quitar <think> sin cierre (texto hasta el final)
    .replace(/<think>[\s\S]*$/gi, "")

    // 3. Quitar etiquetas huérfanas </think>
    .replace(/<\/think>/gi, "")

    // 4. Limpiar espacios en blanco al inicio (dejados por la eliminación)
    .replace(/^\s+/, "")

    // 5. Limpiar múltiples líneas vacías
    .replace(/\n{3,}/g, "\n\n")

    .trim();
}
