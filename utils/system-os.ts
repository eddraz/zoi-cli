import { existsUnixApp } from "~/command/utils/exists-unix-app.ts";
import { getSystemUser, SystemUser } from "~/utils/system-user.ts";
import { linuxOSRelease } from "~/utils/linux-os-release.ts";
import { manageFile } from "~/utils/file.ts";
import { getSystemLanguage, Language } from "./system-language.ts";

export interface OSData {
  name: typeof Deno.build.os;
  arch: typeof Deno.build.arch;
  target: typeof Deno.build.target;
  hostname: string;
  release: string;
  uptime: number;
  home: string;
  information?: Record<string, string>;
}

export interface OperativeSystem {
  os: OSData;
  language: Language;
  user: SystemUser;
  git: string;
}

export async function getOSData(): Promise<OperativeSystem> {
  try {
    const jsonData = JSON.parse(await manageFile("data.json", "{}"));

    const language = await getSystemLanguage();

    const gitWhich = jsonData?.git || await existsUnixApp("git");

    const user = await getSystemUser(gitWhich.toString());

    const os: OSData = {
      name: jsonData?.os?.name || Deno.build.os,
      arch: jsonData?.os?.arch || Deno.build.arch,
      target: jsonData?.os?.target || Deno.build.target,
      hostname: jsonData?.os?.hostname || Deno.hostname(),
      release: jsonData?.os?.release || Deno.osRelease(),
      uptime: jsonData?.os?.uptime || Deno.osUptime(),
      home: jsonData?.os?.home || Deno.env.get("HOME"),
      information: await linuxOSRelease(),
    };

    const response = { os, language, user, git: gitWhich.toString().trim() };

    await manageFile(
      "data.json",
      JSON.stringify({ ...jsonData, ...response }, null, 2),
      { write: true },
    );

    return response;
  } catch (error) {
    throw error;
  }
}
