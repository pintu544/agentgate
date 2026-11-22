/**
 * Prospect research snapshot generation via Exa.
 *
 * POST https://api.exa.ai/search with the `x-api-key` header and
 * contents.text enabled; the response is shaped into the snapshot
 * contract from spec/DESIGN.md: { topic, summary, keyFacts, sources }.
 */
export interface SnapshotSource {
  title: string;
  url: string;
}

export interface Snapshot {
  topic: string;
  summary: string;
  keyFacts: string[];
  sources: SnapshotSource[];
}

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstSentence(text: string, max = 220): string {
  const flat = clean(text);
  const cut = flat.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > 40 ? cut.slice(0, end + 1) : cut).trim();
}

export async function generateSnapshot(topic: string, apiKey: string): Promise<Snapshot> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: topic,
      numResults: 5,
      contents: { text: { maxCharacters: 4000 } },
    }),
  });
  if (!response.ok) {
    throw new Error(`Exa search failed with status ${response.status}`);
  }
  const data = (await response.json()) as { results?: ExaResult[] };
  const results = (data.results ?? []).filter((r) => r.url);
  if (results.length === 0) {
    throw new Error("No sources found for topic");
  }
  const sources: SnapshotSource[] = results.map((r) => ({
    title: r.title ?? r.url!,
    url: r.url!,
  }));
  const keyFacts = results
    .map((r) => (r.text ? firstSentence(r.text) : ""))
    .filter((fact) => fact.length > 0)
    .slice(0, 5);
  const topText = clean(results[0].text ?? "");
  const summary =
    topText.length > 0
      ? topText.slice(0, 600)
      : `Research snapshot for "${topic}" based on ${sources.length} sources.`;
  return { topic, summary, keyFacts, sources };
}
