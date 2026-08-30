import { LlamaCpp } from "../llama-cpp";
import { system } from "../../system";
import config from "~/config.json" with { type: "json" };

export async function sayInUserLanguage(text: string) {
    try {
        const llama = new LlamaCpp({
            port: parseInt(config.ai.port),
        });
        const messagePrompt = `response only in ${system.language.name}, "${text}"`;

        const result = await llama.sendMessage(
            {
                messages: [
                    {
                        role: "user",
                        content: messagePrompt,
                    },
                ],
                model: config.ai.model["granite-4.0-h-1b:BF16"],
                temperature: 0,
                maxTokens: 50,
                threads: 2
            },
        );
        return result;
    } catch (error) {
        console.error(error);
        throw error;
    }
}
