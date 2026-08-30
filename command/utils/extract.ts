export function extractBashCommands(text: string): string[] {
  // La expresión regular busca bloques de código que empiecen con ``` (opcionalmente seguido de bash, sh, o shell)
  // y asegura que no capture lenguajes no deseados ni cruce otros bloques de código
  const regex = /(?:^|\n)```(?:bash|sh|shell)?\h*\r?\n(?!```)((?:(?!```)[\s\S])*?)\s*```/gi;

  const matches = text.matchAll(regex);
  const commands: string[] = [];

  for (const match of matches) {
    if (match[1]) {
      const trimmed = match[1].trim();
      if (trimmed) {
        commands.push(trimmed);
      }
    }
  }

  return commands;
}



