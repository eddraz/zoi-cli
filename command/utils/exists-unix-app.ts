import { runCommand } from "~/command/run.ts";

export async function existsUnixApp(app: string) {
  try {
    return await runCommand({
      commands: ["which", app],
      response: "text"
    }).then((r: string | Deno.ChildProcess) => r.toString());
  } catch(error) {
    throw error;
  }
}
