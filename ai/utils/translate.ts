import { Language } from "~/utils/system-language.ts";
import { LlamaCpp } from "../llama-cpp.ts";
import config from "../../config.json" with { type: "json" };

export type Pair = "ara-eng" | "cat-eng" | "cat-spa" | "deu-eng" | "ell-eng" | "eng-cat" | "eng-deu" | "eng-ell" | "eng-fra" | "eng-ita" | "eng-nld" | "eng-rus" | "eng-spa" | "eng-tur" | "fra-eng" | "ita-eng" | "kor-eng" | "nld-eng" | "rus-eng" | "spa-cat" | "spa-eng" | "spa-eus" | "spa-glg" | "tur-eng" | "zho-eng";

export enum ISO {
    es = "spa",
    en = "eng",
    ca = "cat",
    de = "deu",
    el = "ell",
    fr = "fra",
    it = "ita",
    nl = "nld",
    ru = "rus",
    tr = "tur",
    zh = "zho",
    ko = "kor",
}

export async function translate(pair: Pair, message: string): Promise<string> {
    const command = new Deno.Command("translate", {
        args: [pair, message],
    });

    const { code, stdout, stderr } = await command.output();

    if (code === 0) {
        return new TextDecoder().decode(stdout).trim();
    } else {
        console.error(new TextDecoder().decode(stderr));
        return message.trim();
    }
}
export async function translateText(from: string, to: Language, text: string) {
  const { iso2, iso3, name } = to;
  try {
    const translatedText = await translate(`spa-${iso3}` as Pair, text);
    if (translatedText === text) {
      console.log(">>", translatedText);

      const llama = new LlamaCpp({
        port: parseInt(config.ai.port),
      });
      console.log(`Translate the following text from ${from} to ${name || ""} (ISO2='${iso2}', ISO3='${iso3}'). Keep proper nouns unchanged and adapt punctuation to Italian conventions. Respond only with the translation: "${text}"`)
      const translatedTextAI = await llama.sendMessage(
        {
          messages: [
            {
              role: "user",
              content:
                `Translate the following text from Spanish to ${name || ""} (ISO2='${iso2}', ISO3='${iso3}'). Keep proper nouns unchanged and adapt punctuation to Italian conventions. Respond only with the translation: "${text}"`,
            },
          ],
          model: config.ai.model["granite-4.0-h-1b:BF16"],
          temperature: 0,
          maxTokens: 100,
          threads: 4,
        },
      );

      text = translatedTextAI?.content || text;
    } else {
      text = translatedText;
    }
  } catch (error) {
    console.error(error);
  }

  return text;
}
