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
import { removeThinkTags } from "~/utils/remove-think-tags.ts";
import { bgBlack, cyan } from "@std/fmt/colors";
import { getApps } from "~/utils/apps.ts";

const apps = await getApps();
console.log(apps);
Deno.exit(0);

const encoder = new TextEncoder();
const systemData = await getOSData();
const promptMessage = input(await welcomeText(systemData));
console.log(
  `%c${config.ai["emoji-log"]} ${await dictionaryText(
    systemData,
    "wait-let-me-think",
    "Espera, déjame pensar",
  )}...`,
  config.ai["style-log"],
);
const translatedMessage = await translate(
  `${systemData.language.iso3}-eng` as Pair,
  promptMessage,
);
// console.log(intent);
const llama = new LlamaCpp({
  port: 18080,
});
const request = await llama.sendMessage(
  {
    messages: [
      {
        role: "system",
        content: `Your name is Zoi and you are a CLI assistant.

        RESPONSE RULES:
        1. For programming, technical concepts, or general error explanations: Answer normally and helpfully.
        2. For real-time data, current events, time, date, or ANY information about the user's specific system (hardware, software, files, processes, installed programs): Respond with EXACTLY: "DEV"
        3. Never guess or make up information about the user's system.

        Examples:

        [Real-time / System info → "DEV"]
        User: "What time is it?"
        Zoi: "DEV"

        User: "What is today's date?"
        Zoi: "DEV"

        User: "What is my CPU?"
        Zoi: "DEV"

        User: "How much RAM do I have?"
        Zoi: "DEV"

        User: "What operating system am I running?"
        Zoi: "DEV"

        User: "List my installed programs."
        Zoi: "DEV"

        User: "What is my IP address?"
        Zoi: "DEV"

        User: "What files are in my current directory?"
        Zoi: "DEV"

        User: "What are the latest tech news?"
        Zoi: "DEV"

        [Programming → Answer normally]
        User: "How do I reverse a string in Python?"
        Zoi: "You can reverse a string in Python using slicing: text[::-1]"

        User: "What is the difference between let and const in JavaScript?"
        Zoi: "let allows reassignment while const does not. Both are block-scoped."

        User: "How do I create a thread in Deno?"
        Zoi: "Use the Worker API: new Worker(new URL('./worker.ts', import.meta.url).href, { type: 'module' })"

        [Technical concepts → Answer normally]
        User: "What is a deadlock?"
        Zoi: "A deadlock is when two or more processes are waiting for each other to release resources, causing all of them to be stuck."

        User: "Explain what DNS is."
        Zoi: "DNS (Domain Name System) translates domain names like google.com into IP addresses."

        [Error diagnosis → Answer normally]
        User: "I got 'ENOENT: no such file or directory'. What does it mean?"
        Zoi: "This error means your program tried to access a file or directory that does not exist. Check the path."

        User: "My code throws 'TypeError: Cannot read property of undefined'"
        Zoi: "This happens when you try to access a property on a variable that is undefined. Add a null check before accessing it."`,
      },
      {
        role: "user",
        content: translatedMessage,
      },
    ],
    model: config.ai.model["LFM2.5-1.2B-Thinking-F16"],
    temperature: 0,
    batchSize: 128000,
    threads: 4,
    onChunk: (chunk) => {
      const text = chunk.content;

      if (text) {
        Deno.stdout.write(encoder.encode(bgBlack(cyan(text))));
      }
    },
  },
);
// console.log(
//   `%c${config.ai["emoji-log"]} ${translatedResponse}`,
//   config.ai["style-log"],
// );
console.log("\n");
console.log(
  `%c${config.ai["emoji-log"]} ${await dictionaryText(
    systemData,
    "answer-in-your-language",
    "Permítame responder en su idioma",
  )}`,
  config.ai["style-log"],
);
const response = removeThinkTags(request?.content?.trim() || "");
if (response === "DEV") {
  console.log("TRANSFIRIENDO PREGUNTA AL DESARROLLADOR");
} else if (response !== "") {
  const translatedResponse = await translate(
    `eng-${systemData.language.iso3}` as Pair,
    response || "",
  );
  console.log(
    `%c${config.ai["emoji-log"]} ${translatedResponse}`,
    config.ai["style-log"],
  );
} else {
  console.error("Hubo un error en la respuesta de Zoi");
}
// const { improveMessage, intent } = await userIntent(
//   translatedMessage ?? promptMessage,
// );
Deno.exit(0);
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

const llama2 = new LlamaCpp({
  port: 18080,
});
const intent2 = await llama.sendMessage(
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
    threads: 4,
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
    threads: 4,
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
        threads: 4,
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
          contextSize: 4096,
          threads: 4,
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
              contextSize: 4096,
              threads: 4,
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
    threads: 4,
  },
);
const translatedResponse2 = await translate(
  `eng-${CODE3}` as Pair,
  performantAiResponse?.content?.trim() || "",
);

console.debug(`%c${translatedResponse}`, "color: pink");
