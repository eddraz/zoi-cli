import { ISO, type Pair, translate } from "./ai/utils/translate.ts";
import { LlamaCpp } from "./ai/llama-cpp.ts";
import config from "./config.json" with { type: "json" };
import mcpConfig from "./mpc.json" with { type: "json" };
import { runCommand } from "./command/run.ts";
import { extractBashCommands } from "./command/utils/extract.ts";
import { getOSData } from "~/utils/system-os.ts";
import { welcomeText } from "~/utils/welcome-prompt.ts";
import { input } from "./utils/input.ts";
import { dictionaryText } from "~/utils/dictionary-text.ts";
import { userIntent } from "~/utils/user-intent.ts";
import { getApps } from "~/utils/apps.ts";

const apps = await getApps();
console.log(apps);
Deno.exit(0);
const systemData = await getOSData();
const promptMessage = input(await welcomeText(systemData));
console.log(
  `%c${config.ai["emoji-log"]} ${await dictionaryText(
    systemData,
    "wait-let-me-think",
    "Espera, déjame pensar.",
  )}...`,
  config.ai["style-log"],
);
const translatedMessage = await translate(
  `${systemData.language.iso3}-eng` as Pair,
  promptMessage,
);
const improve = await userIntent(translatedMessage ?? promptMessage);
console.log(translatedMessage, improve);
// console.log(intent);

let message = "";

if (input.length == 0) {
  message = prompt(`Hola ${USER}, en que puedo ayudarte?`) || "";
} else {
  const command = input[0];
  switch (command) {
    case "say":
      message = input.slice(1).join(" ");
      break;
    default:
      message = input.at(0)?.toString() || "";
      break;
  }
}

console.log("Original Message:", message);
console.debug("✋🏻⏳...");

const llama = new LlamaCpp({
  port: 18080,
});
const intent = await llama.sendMessage(
  {
    messages: [
      {
        role: "user",
        content:
          `Act as a prompt engineering expert. Optimize the following instruction, ensuring you include these key elements: 1) The user's primary intent, 2) The context of the task, and 3) The desired output format. Original instruction: "${
            translatedMessage?.trim() ?? message?.trim()
          }"`,
      },
    ],
    model: config.ai.model["LFM2.5-230M:F16"],
    temperature: 0,
    maxTokens: 100,
    threads: 2,
  },
);
const userIntent2 = await llama.sendMessage(
  {
    messages: [
      {
        role: "user",
        content:
          `Extract the main instruction the user wants to execute. Respond exclusively with the clear and direct intent, without any introductory text.

          CONTEXT: "${
            intent?.content?.trim() ?? translatedMessage?.trim() ??
              message?.trim()
          }"
          USER MESSAGE: "${translatedMessage?.trim() ?? message?.trim()}"

          Final instruction:`,
      },
    ],
    model: config.ai.model["granite-4.0-h-1b:BF16"],
    temperature: 0,
    maxTokens: 100,
    threads: 2,
  },
);
const mcpTools = Object.keys(mcpConfig.mcpServers);
const tools: string[] = [];
let context = "";

if (mcpTools.length > 0) {
  for (const tool of mcpTools) {
    const server =
      mcpConfig.mcpServers[tool as keyof typeof mcpConfig.mcpServers];

    const toolValidator = await llama.sendMessage(
      {
        messages: [
          {
            role: "user",
            content:
              `Act as a tool evaluator. Your task is to determine if the described tool is necessary to fulfill the user's intent. Respond ONLY with "TRUE" if it is necessary or "FALSE" if it is not. Do not include any other words.

TOOL DESCRIPTION: "${server.description}"
USER INTENT: "${
                userIntent?.content?.trim() ?? translatedMessage?.trim() ??
                  message?.trim()
              }"

Is this tool necessary?`,
          },
        ],
        model: config.ai.model["qwen2.5-1.5b-coder:Q8"],
        temperature: 0,
        maxTokens: 100,
        threads: 2,
      },
    );

    console.log(tool, toolValidator?.content?.trim().toUpperCase());
    if (toolValidator?.content?.trim().toUpperCase() === "TRUE") {
      let toolExecPrompt =
        `Answer the user's request using ONLY the information provided in the tool output. Do not add external information, guess, or hallucinate facts.

USER REQUEST: "${translatedMessage?.trim() || message?.trim()}"
TOOL OUTPUT: "${JSON.stringify(server)}"

Final Answer:`;

      if (server.command) {
        const cmdTemplate = await runCommand(
          {
            commands: `${server.command} --help`,
            response: "text",
          },
        );
        toolExecPrompt =
          `Act as a system execution engine. Based on the tool description, output ONLY the exact CLI commands separated by semicolons needed to resolve the user's prompt.

TOOL DESCRIPTION: "${server.description}"
TOOL COMMAND TEMPLATE: "${cmdTemplate || server.command}"
USER PROMPT: "${message?.trim()}"

Commands to execute:`;
      }
      console.log("tool exec:", toolExecPrompt);
      const toolResponse = await llama.sendMessage(
        {
          messages: [
            {
              role: "user",
              content: toolExecPrompt,
            },
          ],
          model: config.ai.model["Ministral-3-3B-Instruct-2512:Q8"],
          temperature: 0,
          maxTokens: 100,
          contextSize: 10000,
          threads: 2,
        },
      );
      if (server.command) {
        console.log(toolResponse);
        const commandsToRun = extractBashCommands(
          toolResponse?.content?.trim() ||
            server.command,
        );
        console.log(commandsToRun);

        const commandList = commandsToRun.length > 0
          ? commandsToRun
          : (toolResponse?.content?.trim() || server.command
            ? [toolResponse?.content?.trim() || server.command]
            : []);

        if (commandList.length > 0) {
          let cmdContext = "";
          for (const cmd of commandList) {
            console.log(cmd);
            const toolCmdOutput = await runCommand(
              {
                commands: cmd,
                response: "text",
              },
            );

            console.log(cmd, ":", toolCmdOutput);
            cmdContext += `
----------
Command: \`\`\`bash
${cmd}
\`\`\`

Output: ${toolCmdOutput || ""}
----------`;
          }
          console.log([
            {
              role: "user",
              content:
                `output ONLY the exact CLI commands separated by semicolons needed to resolve the user's prompt.

CONTEXT: ${cmdContext}
USER PROMPT: "${message?.trim()}"`,
            },
          ]);
          const cmdResponse = await llama.sendMessage(
            {
              messages: [
                {
                  role: "user",
                  content:
                    `output ONLY the exact CLI commands separated by semicolons needed to resolve the user's prompt.

CONTEXT: ${cmdContext}
USER PROMPT: "${message?.trim()}"`,
                },
              ],
              model: config.ai.model["Ministral-3-3B-Instruct-2512:Q8"],
              temperature: 0,
              maxTokens: 100,
              contextSize: 10000,
              threads: 2,
            },
          );
          console.log(">>", cmdResponse);
          const toolOutput = await runCommand(
            {
              commands: commandList.join(" && "),
              response: "text",
            },
          );
          context += `
----------
Command:  \`\`\`bash
${commandList.join("\n")}
\`\`\`

Output: ${toolOutput || ""}
----------`;
        }
      } else {
        context += `
----------
Command: ${server.command}

Output:${toolResponse?.content?.trim() || ""}
----------`;
      }
      tools.push(tool);
    }
  }
}

const performantAiResponse = await llama.sendMessage(
  {
    messages: [
      {
        role: "user",
        content:
          `Act as a assistant and respond to the user request based on the context provided to ${USER}. Respond ONLY in markdown format.

CONTEXT: "${context}"
USER REQUEST: "${
            userIntent?.content?.trim() || translatedMessage?.trim() ||
            message?.trim()
          }"

Response:`,
      },
    ],
    model: config.ai.model["LFM2.5-1.2B-Instruct-F16"],
    temperature: 0,
    maxTokens: 100,
    threads: 2,
  },
);
const translatedResponse = await translate(
  `eng-${CODE3}` as Pair,
  performantAiResponse?.content?.trim() || "",
);

console.debug(`%c${translatedResponse}`, "color: pink");
