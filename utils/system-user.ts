import { runCommand } from "~/command/run.ts";
import { manageFile } from "~/utils/file.ts";

export interface SystemUser {
  id: string;
  name?: string;
  email?: string;
}

function username() {
  return Deno.env.get("USER") || Deno.env.get("USERNAME");
}
export function getSystemUserId() {
  let id = username();

  if (!id) {
    id = prompt("Enter your username:") || undefined;

    if (!id) {
      id = "unknown";
    }
  }

  return id;
}
export async function getSystemUserName(whichGit: string) {
  let name = username();

  if (whichGit) {
    try {
      name = await runCommand({
        commands: ["git", "config", "--global", "user.name"],
        response: "text",
      }).then((r: string | Deno.ChildProcess) => r.toString().trim());
    } catch (error) {
      console.error(error);
      name = prompt("Enter your full name:") || undefined;
    }
  }

  return name;
}
export async function getSystemUserEmail(whichGit: string) {
  let email: string | undefined = undefined;

  if (whichGit) {
    try {
      email = await runCommand({
        commands: ["git", "config", "--global", "user.email"],
        response: "text",
      }).then((r: string | Deno.ChildProcess) => r.toString().trim());
    } catch (error) {
      console.error(error);
      email = prompt("Enter your email:") || undefined;
    }
  }

  return email;
}

export async function getSystemUser(whichGit: string): Promise<SystemUser> {
  try {
    const jsonData = JSON.parse(await manageFile("data.json", "{}"));

    return {
      id: jsonData?.user?.id || getSystemUserId(),
      name: jsonData?.user?.name || await getSystemUserName(whichGit),
      email: jsonData?.user?.email || await getSystemUserEmail(whichGit),
    };
  } catch (error) {
    throw error;
  }
}
