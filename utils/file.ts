import { exists } from "@std/fs/exists";

export interface OptionsFile {
  write: boolean;
}

export async function manageFile(path: string, defaultContent: string, options?: OptionsFile) {
  if (path.at(0) !== "/") {
    path = "/" + path;
  }

  const fullpath = Deno.cwd() + path;

  try {
    const fileExists = await exists(fullpath, { isFile: true });
    if (fileExists) {
      if (options?.write) {
        await Deno.writeTextFile(fullpath, defaultContent);
        return defaultContent;
      }
      defaultContent = await Deno.readTextFile(fullpath);
    } else {
      if (!defaultContent) {
        throw new Error("Default content is required.");
      }

      await Deno.writeTextFile(fullpath, defaultContent);
    }

    return defaultContent;
  } catch (error) {
    console.log("no file");
    throw error;
  }
}
