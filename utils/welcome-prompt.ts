import { OperativeSystem } from "~/utils/system-os.ts";
import { translateText } from "~/ai/utils/translate.ts";
import { manageFile } from "~/utils/file.ts";

export async function welcomeText(systemData: OperativeSystem) {
  try {
    const jsonData = JSON.parse(await manageFile("data.json", "{}"));
    const { user: { name, id }, language: { iso2 } } = systemData;

    if (jsonData?.dictionary?.[iso2].welcome) {
      return jsonData.dictionary[iso2].welcome;
    }

    const [firstName = name || id] = name?.split(" ") ?? [];
    let text = `¡Hola ${
      firstName || systemData.user.id
    }!. ¿En que puedo ayudarte?`;

    if (iso2 !== "es") {
      try {
        text = await translateText("Spanish", systemData.language, text);
      } catch (error) {
        console.error(error);
      }
    }

    if (!jsonData.dictionary) {
      jsonData.dictionary = {};
    }
    if (!jsonData.dictionary[iso2]) {
      jsonData.dictionary[iso2] = {};
    }

    jsonData.dictionary[iso2].welcome = text;

    await manageFile(
      "data.json",
      JSON.stringify(jsonData, null, 2),
      { write: true },
    );

    return text.trim();
  } catch (error) {
    throw error;
  }
}
