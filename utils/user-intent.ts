import { LlamaCpp } from "~/ai/llama-cpp.ts";
import config from "~/config.json" with { type: "json" };
import { dictionaryText } from "~/utils/dictionary-text.ts";
import { getOSData } from "~/utils/system-os.ts";

export async function userIntent(message: string) {
  try {
    const llama = new LlamaCpp({
      port: parseInt(config.ai.port),
    });
    const systemData = await getOSData();
    console.log(`%c${config.ai["emoji-log"]} ${await dictionaryText(systemData, "identify-intent-user-prompt", "Voy a identificar la intención detrás de tu instrucción")}...`, config.ai["style-log"]);
    const intent = await llama.sendMessage(
      {
        messages: [
          {
            role: "user",
            content:
              `Act as a prompt engineering expert. Optimize the following instruction, ensuring you include these key elements: 1) The user's primary intent, 2) The context of the task, and 3) The desired output format. Original instruction: "${message}"`,
          },
        ],
        model: config.ai.model["granite-4.0-h-350m:BF16"],
        temperature: 0,
        maxTokens: 100,
        threads: 4,
      },
    );
    console.log(`%c${config.ai["emoji-log"]} ${await dictionaryText(systemData, "improve-prompt", "Permítame mejorar su instrucción")}...`, config.ai["style-log"]);
    const improve = await llama.sendMessage(
      {
        messages: [
          {
            role: "user",
            content:
              `Extract the main instruction the user wants to execute. Respond exclusively with the clear and direct intent, without any introductory text.

              CONTEXT: "${intent?.content?.trim()}"
              USER MESSAGE: "${message}"

              Final instruction:`,
          },
        ],
        model: config.ai.model["granite-4.0-h-1b:BF16"],
        temperature: 0,
        maxTokens: 100,
        threads: 4,
      },
    );

    return {
      intent: intent?.content.trim(),
      improveMessage: improve?.content.trim(),
    };
  } catch (error) {
    throw error;
  }
}
