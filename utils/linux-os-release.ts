import { runCommand } from "~/command/run.ts";
import { manageFile } from "~/utils/file.ts";

export async function linuxOSRelease(): Promise<Record<string, string>> {
  try {
    const jsonData = JSON.parse(await manageFile("data.json", "{}"));

    return await runCommand({
      commands: ["cat", "/etc/os-release"],
      response: "text",
    }).then((r: string | Deno.ChildProcess) => {
      const info = r.toString();
      const row = info.split("\n").filter((r) => r !== "").map((d) => {
        const [key, value] = d.split("=");
        const data: Record<typeof key, string> = {};
        data[key] = jsonData?.os?.information?.[key] ||  value.replace(/^"|"$/g, '');
        return data;
      });
      return Object.assign({}, ...row);
    });
  } catch (error) {
    throw error;
  }
}
