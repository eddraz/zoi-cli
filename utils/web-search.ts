export async function webSearch(query:string) {
  try {
    const SEARXNG_URL = Deno.env.get("SEARXNG_URL") ?? "http://localhost:17380";
    const endpoint = new URL("/search", SEARXNG_URL);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("engines", "google-cse,brave,duckduckgo,startpage,bing");

    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`SearXNG error ${response.status} from ${endpoint}`);
    }

    return await response.json() as {
      results?: Array<{ title?: unknown; content?: string; url?: unknown }>;
    };
  } catch (error) {
    throw error;
  }
}
