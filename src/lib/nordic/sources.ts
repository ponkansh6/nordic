import { XMLParser } from "fast-xml-parser";
import type { NordicCandidate } from "./types";

export interface NordicSourceConfig {
  id: string;
  name: string;
  siteUrl: string;
  feedUrl: string | null;
  articlePathPrefix: string;
  articlePathPattern?: RegExp;
  latestSectionHeading?: string;
}

export const NORDIC_SOURCES: readonly NordicSourceConfig[] = [
  {
    id: "dezeen-finland",
    name: "Dezeen · Finland",
    siteUrl: "https://www.dezeen.com/tag/finland/",
    feedUrl: "https://www.dezeen.com/tag/finland/feed/",
    articlePathPrefix: "/",
    articlePathPattern: /^\/\d{4}\/\d{2}\/\d{2}\//,
  },
  {
    id: "lumene",
    name: "Lumene",
    siteUrl: "https://www.lumene.com/blogs/news",
    feedUrl: "https://www.lumene.com/blogs/news.atom",
    articlePathPrefix: "/blogs/news/",
  },
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});
const REQUEST_TIMEOUT_MS = 8_000;
const HTML_FALLBACK_TIMEOUT_MS = 8_000;
const ARTICLE_PAGE_TIMEOUT_MS = 3_000;
const ARTICLE_PAGE_CONCURRENCY = 2;
const ARTICLE_PAGE_FETCH_LIMIT = 8;
const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1_000;
const USER_AGENT = "NordicArticleCollector/1.0 (+https://github.com/ponkansh6/nordic)";
const UNKNOWN_PUBLISHED_AT = "1970-01-01T00:00:00.000Z";
const robotsCache = new Map<string, { fetchedAt: number; result: Promise<RobotsPolicy | null> }>();

interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsPolicy {
  rules: RobotsRule[];
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

async function fetchText(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: timeoutSignal(timeoutMs),
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/atom+xml, application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      console.warn(`[nordic] ${new URL(url).hostname} returned HTTP ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn(`[nordic] Fetch failed for ${url}:`, error);
    return null;
  }
}

function parseRobotsPolicy(body: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];

  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (rules.length > 0) flush();
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length > 0 && value) {
      rules.push({ path: value, allow: key === "allow" });
    }
  }
  flush();

  const matchingGroups = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || "nordicarticlecollector".includes(agent)),
  );
  return { rules: matchingGroups.flatMap((group) => group.rules) };
}

async function getRobotsPolicy(origin: string): Promise<RobotsPolicy | null> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) return cached.result;

  const request = (async () => {
    try {
      const response = await fetch(new URL("/robots.txt", origin), {
        signal: timeoutSignal(4_000),
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
        redirect: "follow",
      });
      if (response.status === 404) return { rules: [] };
      if (response.status >= 400 && response.status < 500) {
        // RFC 9309 §2.3.1.3 treats 4xx robots.txt responses as unavailable.
        console.warn(
          `[nordic] robots.txt returned HTTP ${response.status}; treating it as unavailable for ${origin}`,
        );
        return { rules: [] };
      }
      if (!response.ok) {
        console.warn(`[nordic] robots.txt returned HTTP ${response.status}; denying ${origin}`);
        return null;
      }
      return parseRobotsPolicy(await response.text());
    } catch (error) {
      console.warn(
        `[nordic] robots.txt request failed for ${origin}:`,
        error instanceof Error ? error.name : "UnknownError",
      );
      return null;
    }
  })();
  robotsCache.set(origin, { fetchedAt: Date.now(), result: request });
  return request;
}

function robotsAllows(url: string, policy: RobotsPolicy): boolean {
  const parsedUrl = new URL(url);
  const path = `${parsedUrl.pathname}${parsedUrl.search}`;
  const matching = policy.rules
    .map((rule) => {
      const anchored = rule.path.endsWith("$");
      const pattern = (anchored ? rule.path.slice(0, -1) : rule.path)
        .split("*")
        .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
        .join(".*");
      const expression = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
      return expression.test(path) ? rule : null;
    })
    .filter((rule): rule is RobotsRule => rule !== null)
    .sort((left, right) => {
      const specificity =
        right.path.replace(/[*$]/g, "").length - left.path.replace(/[*$]/g, "").length;
      return specificity || Number(right.allow) - Number(left.allow);
    });
  return matching[0]?.allow ?? true;
}

async function isAllowed(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  const policy = await getRobotsPolicy(origin);
  if (!policy) {
    console.warn(`[nordic] robots.txt unavailable; skipping ${url}`);
    return false;
  }
  return robotsAllows(url, policy);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const text = record["#text"] ?? record["__cdata"];
  return typeof text === "string" ? text : "";
}

function firstValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textValue(value).trim();
    if (text) return text;
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => decodeCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function decodeCodePoint(codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : " ";
}

function plainText(value: string): string {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    const trackingKeys: string[] = [];
    for (const key of url.searchParams.keys()) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid)/i.test(key)) trackingKeys.push(key);
    }
    for (const key of trackingKeys) {
      url.searchParams.delete(key);
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return null;
  }
}

function feedEntries(xml: string): Record<string, unknown>[] {
  try {
    const parsed = asRecord(xmlParser.parse(xml));
    const rss = asRecord(parsed.rss);
    const channel = asRecord(rss.channel);
    const rdf = asRecord(parsed["rdf:RDF"]);
    const feed = asRecord(parsed.feed);
    const rawEntries = channel.item ?? rdf.item ?? feed.entry;
    if (!rawEntries) return [];
    return (Array.isArray(rawEntries) ? rawEntries : [rawEntries]).map(asRecord);
  } catch (error) {
    console.warn("[nordic] Feed XML could not be parsed:", error);
    return [];
  }
}

function candidateFromFeed(
  entry: Record<string, unknown>,
  source: NordicSourceConfig,
): NordicCandidate | null {
  const title = firstValue(entry.title);
  const linkNodes = Array.isArray(entry.link) ? entry.link : [entry.link];
  const links = linkNodes
    .map((node) => {
      const item = asRecord(node);
      const value = item["@_href"] ?? item["#text"] ?? node;
      return { href: typeof value === "string" ? value : "", rel: item["@_rel"] };
    })
    .filter((item) => item.href.length > 0);
  const link = links.find((item) => item.rel === "alternate")?.href ?? links[0]?.href;
  const url = typeof link === "string" ? normalizeUrl(link, source.siteUrl) : null;
  if (!title || !url) return null;

  const description = firstValue(
    entry.description,
    entry.summary,
    entry.content,
    entry["content:encoded"],
  );
  const enclosure = asRecord(entry.enclosure);
  const media = asRecord(entry["media:content"] ?? entry["media:thumbnail"]);
  const image =
    typeof enclosure["@_url"] === "string"
      ? enclosure["@_url"]
      : typeof media["@_url"] === "string"
        ? media["@_url"]
        : null;
  const publishedAt = firstValue(
    entry.pubDate,
    entry.published,
    entry.updated,
    entry.date,
    entry["dc:date"],
  );
  const parsedDate = publishedAt ? new Date(publishedAt) : null;

  return {
    sourceId: source.id,
    sourceName: source.name,
    title: plainText(title),
    url,
    description: description ? plainText(description).slice(0, 2_000) : null,
    urlToImage: image ? normalizeUrl(image, source.siteUrl) : null,
    publishedAt:
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : UNKNOWN_PUBLISHED_AT,
  };
}

function extractTime(html: string, start: number, end: number): string | null {
  const section = html.slice(Math.max(0, start - 300), Math.min(html.length, end + 700));
  const date = section.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
  if (!date) return null;
  const parsed = new Date(decodeEntities(date));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function metaContent(html: string, property: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (key?.toLowerCase() !== property.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (content) return decodeEntities(content);
  }
  return null;
}

function extractArticleDetails(html: string): {
  description: string | null;
  image: string | null;
  publishedAt: string | null;
} {
  const descriptionMeta =
    metaContent(html, "og:description") ??
    metaContent(html, "description") ??
    metaContent(html, "twitter:description");
  const articleSection =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1] ??
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1] ??
    "";
  const articleText = plainText(
    articleSection
      .replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi, " "),
  );
  const description = articleText.length >= 120 ? articleText : descriptionMeta;
  const publishedAt =
    metaContent(html, "article:published_time") ??
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ??
    null;
  const parsedDate = publishedAt ? new Date(publishedAt) : null;
  return {
    description: description ? description.slice(0, 2_000) : null,
    image: metaContent(html, "og:image"),
    publishedAt:
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
  };
}

async function enrichFromArticlePages(
  candidates: NordicCandidate[],
  source: NordicSourceConfig,
): Promise<NordicCandidate[]> {
  const queue = candidates
    .filter(
      (candidate) =>
        !candidate.description ||
        candidate.description.length < 120 ||
        candidate.publishedAt === UNKNOWN_PUBLISHED_AT,
    )
    .slice(0, ARTICLE_PAGE_FETCH_LIMIT);
  let nextIndex = 0;
  const sourceOrigin = new URL(source.siteUrl).origin;

  const worker = async () => {
    while (nextIndex < queue.length) {
      const candidate = queue[nextIndex++];
      if (!candidate || new URL(candidate.url).origin !== sourceOrigin) continue;
      if (!(await isAllowed(candidate.url))) continue;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const html = await fetchText(candidate.url, ARTICLE_PAGE_TIMEOUT_MS);
      if (!html) continue;
      const details = extractArticleDetails(html);
      if (details.description) candidate.description = details.description;
      if (details.image) candidate.urlToImage = normalizeUrl(details.image, candidate.url);
      if (candidate.publishedAt === UNKNOWN_PUBLISHED_AT && details.publishedAt) {
        candidate.publishedAt = details.publishedAt;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ARTICLE_PAGE_CONCURRENCY, queue.length) }, () => worker()),
  );
  return candidates;
}

function htmlCandidates(html: string, source: NordicSourceConfig): NordicCandidate[] {
  let listingHtml = html;
  let htmlOffset = 0;
  if (source.latestSectionHeading) {
    const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let found = false;
    for (const heading of html.matchAll(headingPattern)) {
      if (plainText(heading[2] ?? "").toLowerCase() !== source.latestSectionHeading.toLowerCase())
        continue;
      const start = (heading.index ?? 0) + heading[0].length;
      const rest = html.slice(start);
      const nextSection = rest.search(/<h[1-2]\b/i);
      listingHtml = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
      htmlOffset = start;
      found = true;
      break;
    }
    if (!found) return [];
  }

  const candidates: NordicCandidate[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of listingHtml.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const title = plainText(match[2] ?? "");
    if (!href || title.length < 8) continue;
    const url = normalizeUrl(decodeEntities(href), source.siteUrl);
    if (!url) continue;
    const urlPath = new URL(url).pathname;
    if (
      !urlPath.startsWith(source.articlePathPrefix) ||
      (source.articlePathPattern && !source.articlePathPattern.test(urlPath))
    )
      continue;
    const path = urlPath.replace(/\/$/, "");
    if (path === source.articlePathPrefix.replace(/\/$/, "") || seen.has(url)) continue;
    seen.add(url);

    const start = match.index ?? 0;
    const end = start + match[0].length;
    const context = listingHtml.slice(
      Math.max(0, start - 250),
      Math.min(listingHtml.length, end + 650),
    );
    const description = plainText(context).replace(title, "").trim().slice(0, 1_200) || null;
    candidates.push({
      sourceId: source.id,
      sourceName: source.name,
      title,
      url,
      description,
      urlToImage: null,
      publishedAt: extractTime(html, start + htmlOffset, end + htmlOffset) ?? UNKNOWN_PUBLISHED_AT,
    });
    if (candidates.length >= 20) break;
  }
  return candidates;
}

export async function fetchLatestFromSource(
  source: NordicSourceConfig,
  limit = 20,
): Promise<NordicCandidate[]> {
  let feedText: string | null = null;
  if (source.feedUrl && (await isAllowed(source.feedUrl)))
    feedText = await fetchText(source.feedUrl);
  const fromFeed = (feedText ? feedEntries(feedText) : [])
    .map((entry) => candidateFromFeed(entry, source))
    .filter((candidate): candidate is NordicCandidate => candidate !== null);
  if (fromFeed.length > 0) return enrichFromArticlePages(fromFeed.slice(0, limit), source);

  if (!(await isAllowed(source.siteUrl))) {
    throw new Error(
      `${source.name}: robots.txt could not be read or disallows the configured page`,
    );
  }
  const html = await fetchText(source.siteUrl, HTML_FALLBACK_TIMEOUT_MS);
  if (!html) throw new Error(`${source.name}: RSS/Atom and article listing were unavailable`);
  const fromPage = htmlCandidates(html, source).slice(0, limit);
  if (fromPage.length === 0)
    throw new Error(`${source.name}: no article links found in the listing`);
  return enrichFromArticlePages(fromPage, source);
}
