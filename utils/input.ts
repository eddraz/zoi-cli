import config from "~/config.json" with { type: "json" };

function arrayToObject(input: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  for (let i = 0; i < input.length; i += 2) {
    const key = input[i];
    const value = input[i + 1] ?? null;
    result[key] = value;
  }

  return result;
}

export function input(welcomeText: string) {
  const input = Deno.args;
  const params = arrayToObject(input);
  let promptMessage = "";

  if (input.length > 0) {
    if (input.length === 1) {
      const [text] = input;
      promptMessage = text;
    } else {
      console.log(`%c${config.ai["emoji-log"]} ${welcomeText}`, config.ai["style-log"]);
      promptMessage = params["-p"] || params["--prompt"] || prompt("👤") || "";
    }
  } else {
    console.log(`%c${config.ai["emoji-log"]} ${welcomeText}`, config.ai["style-log"]);
    promptMessage = prompt("👤") || "";
  }

  return promptMessage.trim();
}
