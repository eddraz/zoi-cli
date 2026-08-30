import { LlamaCpp, type JsonSchema } from "../llama-cpp";
import config from "~/config.json" with { type: "json" };
import { system } from "@/core/system";
import { extractJSONFromText } from "../../utils/json";

export type PromptCategory = "basic" | "terminal" | "code";
export type DifficultyLevel = "easy" | "medium" | "hard";

export interface PromptDifficulty {
    category: PromptCategory; // "basic" | "terminal" | "code"
    level: DifficultyLevel;   // "easy" | "medium" | "hard"
    score: number;            // Escala del 1 al 5
    reason: string;
}

const difficultySchema: JsonSchema = {
    type: "json_schema",
    json_schema: {
        name: "prompt_difficulty",
        strict: true,
        schema: {
            type: "object",
            properties: {
                category: {
                    type: "string",
                    enum: ["basic", "terminal", "code"],
                },
                level: {
                    type: "string",
                    enum: ["easy", "medium", "hard"],
                },
                score: {
                    type: "number",
                },
                reason: {
                    type: "string",
                },
            },
            required: ["category", "level", "score", "reason"],
        },
    },
};

export async function detectDifficulty(text: string): Promise<PromptDifficulty> {
    try {
        const llama = new LlamaCpp({
            port: parseInt(config.ai.port),
        });
        const systemPrompt = `You are an AI classifier that analyzes user prompts.
Classify the user prompt into one of these categories:
- "basic": General conversation, casual chatting, greetings ("hola", "hi"), simple factual questions, general explanations without code or terminal commands.
- "terminal": OS/PC operations, hardware inspection (RAM, CPU, disk), system information, date/time, filesystem manipulation, executing shell commands.
- "code": Programming requests, writing/debugging code, scripts, software development, algorithms, web development (HTML, CSS, JS, React, etc.).

Difficulty level:
- "easy": Basic greetings, trivial questions, simple single commands (e.g. check RAM or date), trivial 1-liner code. Score: 1-2.
- "medium": Multi-step operations, intermediate functions/components, scripts with flags/logic. Score: 3.
- "hard": Full applications, complex programming/architecture, deep debugging, landing pages, multi-stage systems. Score: 4-5.`;

        const result = await llama.sendMessage({
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: `Analyze this user request: "${text}"`,
                },
            ],
            json_schema: difficultySchema,
            model: config.ai.model["granite-4.0-h-350m:BF16"],
            temperature: 0,
            maxTokens: 150,
            threads: 4,
        });

        if (result?.content) {
            const parsed = extractJSONFromText(result.content);
            if (
                parsed &&
                (parsed.category === "basic" || parsed.category === "terminal" || parsed.category === "code") &&
                (parsed.level === "easy" || parsed.level === "medium" || parsed.level === "hard")
            ) {
                return {
                    category: parsed.category,
                    level: parsed.level,
                    score: typeof parsed.score === "number" ? parsed.score : (parsed.level === "easy" ? 1 : parsed.level === "medium" ? 3 : 5),
                    reason: parsed.reason || "",
                };
            }
        }

        return {
            category: "basic",
            level: "easy",
            score: 1,
            reason: "Default fallback classification",
        };
    } catch (error) {
        console.error("Error detecting difficulty and category:", error);
        return {
            category: "basic",
            level: "easy",
            score: 1,
            reason: "Error during detection",
        };
    }
}

const improveSchema: JsonSchema = {
    type: "json_schema",
    json_schema: {
        name: "improved_message",
        strict: true,
        schema: {
            type: "object",
            properties: {
                improved: {
                    type: "string",
                    description: "The improved, concise, and natural version of the user request in English.",
                },
            },
            required: ["improved"],
        },
    },
};

export async function improveMessage(text: string) {
    try {
        const llama = new LlamaCpp({
            port: parseInt(config.ai.port),
        });

        const result = await llama.sendMessage(
            {
                messages: [
                    {
                        role: "system",
                        content: "You are an AI prompt optimizer. Rewrite the user input in English to make it clear, natural, and well-structured. Do not add introductory or conversational filler.",
                    },
                    {
                        role: "user",
                        content: text,
                    },
                ],
                json_schema: improveSchema,
                model: config.ai.model["granite-4.0-h-1b:BF16"],
                temperature: 0.2,
                maxTokens: 80,
                threads: 4,
            },
        );

        if (result?.content) {
            const parsed = extractJSONFromText(result.content);
            if (parsed && typeof parsed.improved === "string" && parsed.improved.trim()) {
                return {
                    ...result,
                    content: parsed.improved.trim(),
                };
            }
            return {
                ...result,
                content: result.content.replace(/^["']|["']$/g, "").trim(),
            };
        }

        return result;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export async function sayGoal(text: string) {
    try {
        const llama = new LlamaCpp({
          port: parseInt(config.ai.port),
        });
        const messagePrompt = `describe only the intent of this conversation and response only with the intent, "${text}"`;

        const result = await llama.sendMessage(
            {
                messages: [
                    {
                        role: "user",
                        content: messagePrompt,
                    },
                ],
                model: config.ai.model["granite-4.0-h-350m:BF16"],
                temperature: 0,
                maxTokens: 50,
                threads: 4
            },
        );
        return result;
    } catch (error) {
        console.error(error);
        throw error;
    }
}


export async function sayStepsToAchieveGoal(text: string) {
    try {
        const llama = new LlamaCpp({
          port: parseInt(config.ai.port),
        });
        const messagePrompt = `Give me the best and most efficient steps list to achieve the intent of this conversation and response only with the steps to ${system.platform} in JSON format with the following structure: { "steps": ["step1", "step2", "step3"] }, "${text}"`;

        const result = await llama.sendMessage(
            {
                messages: [
                    {
                        role: "user",
                        content: messagePrompt,
                    },
                ],
                model: config.ai.model["qwen2.5-1.5b-coder:Q8"],
                temperature: 0,
                maxTokens: 100,
                threads: 4
            },
        );
        return result;
    } catch (error) {
        console.error(error);
        throw error;
    }
}
