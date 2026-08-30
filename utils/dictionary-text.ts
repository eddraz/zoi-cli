import { OperativeSystem } from "~/utils/system-os.ts";
import { translateText } from "~/ai/utils/translate.ts";
import { manageFile } from "~/utils/file.ts";

export async function dictionaryText(
  systemData: OperativeSystem,
  keyDictionary: string,
  text: string,
) {
  if (!keyDictionary) {
    throw new Error("Key dictionary parameter is required.");
  }
  if (!text) {
    throw new Error("Text parameter is required.");
  }

  try {
    const jsonData = JSON.parse(await manageFile("data.json", "{}"));
    const { language: { iso2 } } = systemData;

    if (jsonData?.dictionary?.[iso2][keyDictionary]) {
      return jsonData.dictionary[iso2][keyDictionary];
    }

    if (iso2 !== "es") {
      try {
        text = await translateText("Spanish", systemData.language, text);
      } catch (error) {
        console.error(error);
      }
    }

    jsonData.dictionary[iso2][keyDictionary] = text;

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
