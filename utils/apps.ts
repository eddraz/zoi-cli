import { runCommand } from "~/command/run.ts";
import { manageFile } from "~/utils/file.ts";
import { OperativeSystem } from "~/utils/system-os.ts";
import { LlamaCpp } from "~/ai/llama-cpp.ts";
import config from "../config.json" with { type: "json" };
import { webSearch } from "~/utils/web-search.ts";
import { isSPA } from "~/utils/is-spa.ts";
import { getContentSPA } from "~/utils/content-spa.ts";
import { htmlToMarkdown } from "~/utils/html-to-markdown.ts";
import { dictionaryText } from "~/utils/dictionary-text.ts";
import { markdownToText } from "~/utils/markdown-to-text.ts";
import { removeAccents } from "~/utils/remove-accents.ts";
import { DenoKV } from "~/utils/deno-kv.ts";

export interface App {
  name: string;
  description?: string;
  usage?: string;
  searchContent?: string;
}

async function getWebSuccessfully(
  results: Array<{
    title?: unknown;
    content?: string;
    url?: unknown;
  }>,
) {
  const { url } = results[0];
  const endpoint = new URL(url as string);
  const response = await fetch(endpoint);

  if (!response.ok) {
    results.shift();
    return getWebSuccessfully(results);
  }

  return { url, html: await response.text() };
}

async function getUsage(appName: string) {
  try {
    return await runCommand({
      commands: [appName, "--help"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => r.toString().trim());
  } catch (error) {
    console.error(error);
  }
}
export async function getDescription(app: App) {
  try {
    const llama = new LlamaCpp({
      port: parseInt(config.ai.port),
    });
    const response = await llama.sendMessage(
      {
        messages: [
          {
            role: "user",
            content: `What is the '${app.name}' CLI application or command.

              CONTEXT: ${app.usage}`,
          },
        ],
        model: config.ai.model["LFM2.5-230M:F16"],
        temperature: 0,
        maxTokens: 32000,
        contextSize: 32000,
        threads: 2,
      },
    );

    return response?.content;
  } catch (error) {
    console.error(error);
  }
}
export async function getSearchContent(app: App) {
  try {
    const llama = new LlamaCpp({
      port: parseInt(config.ai.port),
    });

    const query = `What is the '${app.name}' CLI application or command?`;
    console.log(query)
    const webSearchResponse = await webSearch(query);
    const webSearchResults = webSearchResponse.results;
    if (webSearchResults && webSearchResults.length > 0) {
      let { url, html } = await getWebSuccessfully(webSearchResults);

      if (await isSPA(html)) {
        html = await getContentSPA(url as string) || html;
      }

      const define = await llama.sendMessage(
        {
          messages: [
            {
              role: "user",
              content: `What is the '${app.name}' CLI application or command.

                ${
                removeAccents(
                  markdownToText(htmlToMarkdown(html)),
                )
              }`,
            },
          ],
          model: config.ai.model["LFM2.5-230M:F16"],
          temperature: 0,
          maxTokens: 32000,
          contextSize: 32000,
          threads: 2,
        },
      );
      const description = define?.content;
      app.description = `${description}\n\n${app.description}`;
    }

    app.searchContent = app.description;

    if (app.description) {
      app.searchContent = removeAccents(
        markdownToText(app.description).toLowerCase(),
      );
    }

    return app.searchContent;
  } catch (error) {
    console.error(error);
  }
}

async function loopApps(
  systemData: OperativeSystem,
  denoKV: DenoKV,
  paths: string[],
  apps: Record<string, App>,
) {
  let toEdit = false;
  const kv = await denoKV.connect();
  const appName = paths[0];
  console.log(
    `%c${config.ai["emoji-log"]} ${await dictionaryText(
      systemData,
      "verifying-command",
      `Verificando el comando`,
    )}:`,
    config.ai["style-log"],
    `\`${appName}\``,
  );
  console.log(paths)

  if (typeof appName === "string") {
    const appBD = await kv.get(["apps", appName]);
    const appDBValue = appBD.value as App;
    const app: App = appDBValue || {
      name: appName,
    };
    const existsApp = await runCommand({
      commands: ["which", app.name],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => r.toString().trim());

    if (existsApp) {
      if (!appBD.value) {
        app.usage = await getUsage(app.name);

        console.log(
          `%c${config.ai["emoji-log"]} ${await dictionaryText(
            systemData,
            "reviewing-command-documentation",
            `Revisando la documentación del comando`,
          )}...`,
          config.ai["style-log"],
        );
        app.description = await getDescription(app);

        console.log(
          `%c${config.ai["emoji-log"]} ${await dictionaryText(
            systemData,
            "reviewing-command-web-documentation",
            `Revisando la documentación web del comando`,
          )}...`,
          config.ai["style-log"],
        );
        app.searchContent = await getSearchContent(app);

        toEdit = true;
      } else {
        if (!appDBValue.usage) {
          app.usage = await getUsage(app.name);
          toEdit = true;
        }
        if (!appDBValue.description) {
          console.log(
            `%c${config.ai["emoji-log"]} ${await dictionaryText(
              systemData,
              "reviewing-command-documentation",
              `Revisando la documentación del comando`,
            )}...`,
            config.ai["style-log"],
          );
          app.description = await getDescription(app);
          toEdit = true;
        }
        if (!appDBValue.searchContent) {
          console.log(
            `%c${config.ai["emoji-log"]} ${await dictionaryText(
              systemData,
              "reviewing-command-web-documentation",
              `Revisando la documentación web del comando`,
            )}...`,
            config.ai["style-log"],
          );
          app.searchContent = await getSearchContent(app);
          toEdit = true;
        }
      }
    } else {
      apps[app.name] = app;
      paths.shift();
      return await loopApps(systemData, denoKV, paths, apps);
    }

    apps[app.name] = app;

    if (toEdit) {
      paths.shift();
      await kv.set(["apps", app.name], app);
      return await loopApps(systemData, denoKV, paths, apps);
    }
  }

  if (paths.length > 0 && apps[appName]) {
    paths.shift();
    return await loopApps(systemData, denoKV, paths, apps);
  }

  return apps;
}

export async function getApps() {
  try {
    const systemData = JSON.parse(await manageFile("data.json", "{}"));
    const denoKV = new DenoKV({ path: "/apps.db" });
    const userLocalBinPath = await runCommand({
      commands: ["ls", systemData.os.home + "/.local/bin"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => {
      const info = r.toString().trim();
      return info;
    });
    const userLocalBinApps = await loopApps(
      systemData,
      denoKV,
      userLocalBinPath.split("\n"),
      {},
    );
    const localBinPath = await runCommand({
      commands: ["ls", "/bin"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => {
      const info = r.toString().trim();
      return info;
    });
    const localBinApps = await loopApps(
      systemData,
      denoKV,
      localBinPath.split("\n"),
      {},
    );
    const usrLocalBinPath = await runCommand({
      commands: ["ls", "/usr/local/bin"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => {
      const info = r.toString().trim();
      return info;
    });
    const usrLocalBinApps = await loopApps(
      systemData,
      denoKV,
      usrLocalBinPath.split("\n"),
      {},
    );

    console.log(usrLocalBinApps);
  } catch (error) {
    throw error;
  }
}
