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
  appName: string,
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
    if (results.length > 0) {
      results.shift();
      return getWebSuccessfully(appName, results);
    }
  }
  const html = await response.text();
  const textContent = removeAccents(
    markdownToText(htmlToMarkdown(html)),
  );

  if (textContent.indexOf(appName) < 0) {
    if (results.length > 0) {
      results.shift();
      return getWebSuccessfully(appName, results);
    }
  }

  return { url, html };
}

async function getManAndWhatis(appName: string): Promise<{ whatis?: string; man?: string; combined?: string }> {
  let whatisOutput = "";
  let manOutput = "";

  try {
    const whatisRes = await runCommand({
      commands: `whatis ${appName} 2>/dev/null`,
      response: "text",
      timeout: 2000,
    });
    if (typeof whatisRes === "string" && whatisRes.trim() && !whatisRes.includes("nothing appropriate")) {
      whatisOutput = whatisRes.trim();
    }
  } catch (_) {}

  try {
    const manRes = await runCommand({
      commands: `man -P cat ${appName} 2>/dev/null | head -n 150`,
      response: "text",
      timeout: 3000,
    });
    if (typeof manRes === "string" && manRes.trim() && !manRes.includes("No manual entry")) {
      manOutput = manRes.trim();
    }
  } catch (_) {}

  const parts: string[] = [];
  if (whatisOutput) parts.push(`WHATIS:\n${whatisOutput}`);
  if (manOutput) parts.push(`MANUAL:\n${manOutput}`);

  return {
    whatis: whatisOutput || undefined,
    man: manOutput || undefined,
    combined: parts.length > 0 ? parts.join("\n\n") : undefined,
  };
}

async function getUsage(appName: string): Promise<string> {
  try {
    const cmd = await runCommand({
      commands: `timeout 1.5 ${appName} --help 2>&1`,
      response: "text",
      timeout: 3000,
    });
    return (cmd as string)?.toString().trim() || "";
  } catch (error) {
    console.error(`[getUsage] Failed to get usage for ${appName}:`, error);
    return "";
  }
}
export async function getDescription(app: App, systemData: OperativeSystem) {
  try {
    const llama = new LlamaCpp({
      port: parseInt(config.ai.port),
    });
    const response = await llama.sendMessage(
      {
        messages: [
          {
            role: "user",
            content: `Explain what the '${app.name}' command does in ${
              systemData.os.information?.["PRETTY_NAME"] || systemData.os.name
            }.

            CONTEXT: ${app.usage}`,
          },
        ],
        model: config.ai.model["LFM2.5-230M:F16"],
        temperature: 0,
        maxTokens: 1000,
        contextSize: 4096,
        threads: 4,
      },
    );

    return response?.content;
  } catch (error) {
    console.error(error);
  }
}
export async function getSearchContent(app: App, systemData: OperativeSystem) {
  try {
    const llama = new LlamaCpp({
      port: parseInt(config.ai.port),
    });
    const query = `"${app.name}" CLI binary application in ${
      systemData.os.information?.["PRETTY_NAME"] || systemData.os.name
    }.`;
    console.log(query);

    let docContent = "";

    try {
      const webSearchResponse = await webSearch(query);
      const webSearchResults = webSearchResponse?.results;
      console.log("webSearchResponse", webSearchResponse);

      if (webSearchResults && webSearchResults.length > 0) {
        const webDoc = await getWebSuccessfully(app.name, [...webSearchResults]);
        if (webDoc?.html) {
          let html = webDoc.html;
          if (await isSPA(html)) {
            html = (await getContentSPA(webDoc.url as string)) || html;
          }
          if (html) {
            docContent = removeAccents(markdownToText(htmlToMarkdown(html)));
          }
        }
      }
    } catch (webErr) {
      console.warn(`[getSearchContent] Web search failed for ${app.name}:`, webErr);
    }

    // Fallback: si no se obtuvieron resultados de la web o no se encontró contenido relevante, usar `whatis` y `man`
    if (!docContent) {
      console.log(`ℹ️ Sin resultados web para '${app.name}'. Obteniendo documentación local con 'whatis' y 'man'...`);
      const localDoc = await getManAndWhatis(app.name);
      if (localDoc.combined) {
        docContent = localDoc.combined;
      }
    }

    if (docContent) {
      const define = await llama.sendMessage(
        {
          messages: [
            {
              role: "user",
              content: `Explain what the '${app.name}' command does in ${
                systemData.os.information?.["PRETTY_NAME"] || systemData.os.name
              }. Include its purpose, typical use cases, and a basic usage example.

                ${docContent}`,
            },
          ],
          model: config.ai.model["LFM2.5-230M:F16"],
          temperature: 0,
          maxTokens: 1000,
          contextSize: 4096,
          threads: 4,
        },
      );
      app.description = `${define?.content || ""}\n-------\n${app.description || ""}`;
    }

    app.searchContent = app.description;
    console.log(app);

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
  console.log(paths, typeof appName);

  if (typeof appName === "string") {
    const appBD = await kv.get(["apps", appName]);
    const appDBValue = appBD.value as App;
    const app: App = appDBValue || {
      name: appName,
    };
    console.log(app);
    const existsApp = await runCommand({
      commands: ["which", app.name],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => r.toString().trim());
    console.log(existsApp);

    if (existsApp) {
      console.log(appBD.value, !appBD.value);
      if (!appBD.value) {
        app.usage = await getUsage(app.name);

        console.log(app);

        console.log(
          `%c${config.ai["emoji-log"]} ${await dictionaryText(
            systemData,
            "reviewing-command-documentation",
            `Revisando la documentación del comando`,
          )}...`,
          config.ai["style-log"],
        );
        app.description = await getDescription(app, systemData);

        console.log(
          `%c${config.ai["emoji-log"]} ${await dictionaryText(
            systemData,
            "reviewing-command-web-documentation",
            `Revisando la documentación web del comando`,
          )}...`,
          config.ai["style-log"],
        );
        app.searchContent = await getSearchContent(app, systemData);

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
          app.description = await getDescription(app, systemData);
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
          app.searchContent = await getSearchContent(app, systemData);
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
    const denoKV = new DenoKV({ path: "/zoi.db" });
    const userLocalBinPath = await runCommand({
      commands: ["ls", systemData.os.home + "/.local/bin"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => {
      const info = r.toString().trim();
      return info;
    });
    const localBinPath = await runCommand({
      commands: ["ls", "/bin"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => {
      const info = r.toString().trim();
      return info;
    });
    const apps = await loopApps(
      systemData,
      denoKV,
      [...userLocalBinPath.split("\n"), ...localBinPath.split("\n")].filter(
        (t) => t && t.length > 0,
      ),
      {},
    );

    console.log(apps);
    return apps;
  } catch (error) {
    throw error;
  }
}
