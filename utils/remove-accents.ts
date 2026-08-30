export function removeAccents(text: string): string {
  return text
    .normalize("NFD") // Descompone: á → a + ́ (acento separado)
    .replace(/[\u0300-\u036f]/g, ""); // Elimina los acentos (marcas diacríticas)
}
