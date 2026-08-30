import MiniSearch, { type SearchResult } from 'minisearch';
import mpcConfig from "~/mpc.json" with { type: "json" };
import { LlamaCpp } from '../llama-cpp.ts';
import config from "~/config.json" with { type: "json" };

// Configuración e indexación de MiniSearch para los servidores MCP
export interface McpDoc {
    id: string;
    name: string;
    description: string;
    tags: string;
    command: string;
    args?: string[];
}

const miniSearch = new MiniSearch<McpDoc>({
    fields: ["name", "description", "tags"],
    storeFields: ["name", "description", "tags", "command", "args"],
    searchOptions: {
        boost: { tags: 2, name: 1.5 },
        fuzzy: 0.2,
        prefix: true,
    },
});

const mcpDocs: McpDoc[] = Object.entries(mpcConfig.mcpServers).map(([name, item]) => ({
    id: name,
    name,
    description: item.description,
    tags: item.tags.join(" "),
    command: item.command,
    args: (item as { args?: string[] }).args,
}));

miniSearch.addAll(mcpDocs);

export function getTool(tags: string[] | string) {
    const query = Array.isArray(tags) ? tags.join(" ") : tags;
    return miniSearch.search(query);
}

export async function searchTags(text: string) {
    try {
        const llama = new LlamaCpp({
            port: parseInt(config.ai.port),
        });
        const messagePrompt = `Analyze the given task or intent and extract 2 to 10 concise search keywords/tags (in English) representing the tools or actions required. Respond ONLY in JSON format: { "tags": ["tag1", "tag2", "tag3"] }. Task: "${text}"`;

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
                maxTokens: 1000,
                threads: 4
            },
        );
        return result;
    } catch (error) {
        throw error;
    }
}

export async function updateTool(tool: SearchResult, text: string) {
    try {
        const llama = new LlamaCpp({
          port: parseInt(config.ai.port),
        });
        const defaultArgs = JSON.stringify(tool.args || []);
        const messagePrompt = `You are a system command generator.
Tool: "${tool.name}" (${tool.description})
Base command: "${tool.command}"
Default arguments: ${defaultArgs}
User request: "${text}"

Based on the user request, adapt the command arguments (e.g. replace target folder/file paths, add flags/options) to fulfill what the user asked.
Respond ONLY with a valid JSON object in this exact format:
{ "command": "${tool.command}", "args": ["arg1", "arg2"] }`;

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
        throw error;
    }
}
