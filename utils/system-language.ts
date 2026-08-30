import { manageFile } from "~/utils/file.ts";
import { ISO } from "~/ai/utils/translate.ts";
import { LlamaCpp } from "~/ai/llama-cpp.ts";
import config from "../config.json" with { type: "json" };
import { dictionaryText } from "~/utils/dictionary-text.ts";
import { getOSData } from "~/utils/system-os.ts";

export interface Language {
  iso2: string;
  iso3: string;
  code: string;
  name?: string;
}

export async function getSystemLanguage() {
  try {
    const jsonData = JSON.parse(await manageFile("data.json", "{}"));

    const LANG_CODE = jsonData?.language?.code || navigator.language;
    let LANG_CODE_ISO2 = jsonData?.language?.iso2;
    if (!LANG_CODE_ISO2) {
      const [ISO2] = LANG_CODE.split("-");
      LANG_CODE_ISO2 = ISO2;
    }
    const LANG_CODE_ISO3 = jsonData?.language?.iso3 ||
      ISO[LANG_CODE_ISO2 as keyof typeof ISO];
    const language: Language = {
      code: LANG_CODE,
      iso2: LANG_CODE_ISO2,
      iso3: LANG_CODE_ISO3,
    };

    language.name = jsonData?.language?.name as string | undefined;

    if (!language.name) {
      const llama = new LlamaCpp({
        port: parseInt(config.ai.port),
      });
      const systemData = await getOSData();
      console.log(`%c${config.ai["emoji-log"]} ${await dictionaryText(systemData, "detecting-language", "Detectando idioma")}...`, config.ai["style-log"]);
      const languageName = await llama.sendMessage(
        {
          messages: [
            {
              role: "user",
              content:
                `Respond only with the name of the language corresponding to ISO2='${LANG_CODE_ISO2}' and ISO3='${LANG_CODE_ISO3}'. Do not include any additional explanations."`,
            },
          ],
          model: config.ai.model["LFM2.5-230M:F16"],
          temperature: 0,
          maxTokens: 100,
          threads: 2,
        },
      );
      language.name = languageName?.content;
    }

    return language;
  } catch (error) {
    throw error;
  }
}
