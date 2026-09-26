import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NordicSourceConfig } from "@/lib/nordic/sources";

const source: NordicSourceConfig = {
  id: "test-source",
  name: "Test source",
  siteUrl: "https://source.test/stories",
  feedUrl: "https://source.test/feed.xml",
  articlePathPrefix: "/stories/",
};

describe("Nordic source adapters", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchLatestFromSource: (config: NordicSourceConfig, limit?: number) => Promise<unknown[]>;
  let sources: typeof import("@/lib/nordic/sources");

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sources = await import("@/lib/nordic/sources");
    fetchLatestFromSource = sources.fetchLatestFromSource;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses RSS entries, sanitizes text, normalizes URLs, and reads media", async () => {
    const description = `Nordic furniture and materials ${"with useful background ".repeat(8)}`;
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nDisallow: /feed\nAllow: /feed.xml\nAllow: /", {
          status: 200,
        });
      if (url.endsWith("feed.xml")) {
        return new Response(
          `<rss><channel><item><title>Oak &amp; &quot;Light&quot;</title><link>/stories/oak?utm_source=rss&amp;ref=home#intro</link><description>&lt;p&gt;${description}&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;</description><pubDate>Fri, 25 Sep 2026 12:00:00 GMT</pubDate><enclosure url="/oak.jpg?gclid=ad" /></item><item><title>Broken link</title><link>http://[</link></item></channel></rss>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const results = await fetchLatestFromSource(source);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceId: source.id,
      title: 'Oak & "Light"',
      url: "https://source.test/stories/oak?ref=home",
      description: description.trim(),
      urlToImage: "https://source.test/oak.jpg",
      publishedAt: "2026-09-25T12:00:00.000Z",
    });
  });

  it("parses Atom links and enriches an article when feed metadata is incomplete", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml")) {
        return new Response(
          `<feed><entry><title>Nordic materials</title><link rel="self" href="/feed.xml"/><link rel="alternate" href="/stories/materials"/><summary>Short feed text</summary></entry></feed>`,
          { status: 200 },
        );
      }
      if (url.includes("/stories/materials")) {
        return new Response(
          `<html><head><meta property="og:description" content="A detailed article about Nordic materials and design."/><meta property="og:image" content="/images/materials.jpg?utm_campaign=x"/><meta property="article:published_time" content="2026-09-20T08:30:00Z"/></head><article><p>${"This article explains Nordic material choices and their place in everyday life. ".repeat(3)}</p></article></html>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const results = await fetchLatestFromSource(source);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Nordic materials",
      url: "https://source.test/stories/materials",
      description: expect.stringContaining("This article explains Nordic material choices"),
      urlToImage: "https://source.test/images/materials.jpg",
      publishedAt: "2026-09-20T08:30:00.000Z",
    });
  });

  it("allows a more specific robots rule and decodes numeric entities in HTML listings", async () => {
    const description =
      "A detailed listing with enough context to avoid an article page request. ".repeat(3);
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /feed\nAllow: /feed.xml", { status: 200 });
      }
      if (url.endsWith("feed.xml")) {
        return new Response(
          `<rss><channel><item><title>Not valid</title><link>javascript:alert(1)</link></item></channel></rss>`,
          { status: 200 },
        );
      }
      if (url.endsWith("/stories")) {
        return new Response(
          `<div>${description}<time datetime="2026-09-20T00:00:00Z"></time><a href="/stories/coded?q=&#49;&amp;utm_source=feed">A Nordic story &#x31; &#1114112; now</a></div>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const results = await fetchLatestFromSource(source);
    expect(results[0]).toMatchObject({
      title: "A Nordic story 1 now",
      url: "https://source.test/stories/coded?q=1",
      publishedAt: "2026-09-20T00:00:00.000Z",
    });
  });

  it("handles network failures and inaccessible robots policies", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      throw new Error("connection failed");
    });
    await expect(fetchLatestFromSource(source)).rejects.toThrow(
      "RSS/Atom and article listing were unavailable",
    );

    const blocked = {
      ...source,
      siteUrl: "https://robots-error.test/stories",
      feedUrl: "https://robots-error.test/feed.xml",
    };
    fetchMock.mockRejectedValue(new Error("robots unreachable"));
    await expect(fetchLatestFromSource(blocked)).rejects.toThrow(
      "robots.txt could not be read or disallows",
    );
  });

  it("treats a robots 4xx response as unavailable and falls back to the article listing", async () => {
    const listingOnlySource: NordicSourceConfig = {
      ...source,
      feedUrl: null,
    };
    const description = "A detailed article summary about Nordic design and materials. ".repeat(3);
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("forbidden", { status: 403 });
      if (url.endsWith("/stories")) {
        return new Response(
          `<h2>Latest stories</h2><p>${description}</p><time datetime="2026-09-20T00:00:00Z"></time><a href="/stories/latest">A latest Nordic design story</a>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const results = await fetchLatestFromSource(listingOnlySource);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "A latest Nordic design story",
      url: "https://source.test/stories/latest",
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[nordic] robots.txt returned HTTP 403; treating it as unavailable for https://source.test",
    );
  });

  it("falls back cleanly when the XML parser throws", async () => {
    vi.doMock("fast-xml-parser", () => ({
      XMLParser: class {
        parse() {
          throw new Error("malformed xml");
        }
      },
    }));
    vi.resetModules();
    const parserErrorSources = await import("@/lib/nordic/sources");
    vi.doUnmock("fast-xml-parser");
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml")) return new Response("broken xml", { status: 200 });
      return new Response("<main>No article links.</main>", { status: 200 });
    });

    await expect(parserErrorSources.fetchLatestFromSource(source)).rejects.toThrow(
      "no article links found",
    );
    expect(console.warn).toHaveBeenCalledWith(
      "[nordic] Feed XML could not be parsed:",
      expect.any(Error),
    );
  });

  it("keeps metadata fallbacks optional when article pages omit image and date tags", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml")) {
        return new Response(
          `<feed><entry><title>Metadata fallback</title><link href="/stories/fallback"/><summary>short</summary></entry></feed>`,
          { status: 200 },
        );
      }
      if (url.includes("/stories/fallback")) {
        return new Response(
          `<meta name="description" content="Useful article detail from a metadata fallback."/><article><p>Short body.</p></article>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const results = await fetchLatestFromSource(source);
    expect(results[0]).toMatchObject({
      description: "Useful article detail from a metadata fallback.",
      urlToImage: null,
      publishedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("uses the configured latest section and limits HTML listing candidates", async () => {
    const designSource: NordicSourceConfig = {
      ...source,
      latestSectionHeading: "Latest stories",
    };
    const links = Array.from(
      { length: 4 },
      (_, index) =>
        `<div>${"A story about Nordic craft and furniture. ".repeat(4)}<time datetime="2026-09-20T00:00:00Z"></time><a href="/stories/item-${index}">Design story number ${index}</a></div>`,
    ).join("");
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml")) return new Response("unavailable", { status: 503 });
      if (url.endsWith("/stories")) {
        return new Response(
          `<h2>Archive</h2><h2>Latest stories</h2>${links}<h2>Older stories</h2><a href="/stories/old">Older article</a>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const results = await fetchLatestFromSource(designSource, 2);
    expect(results).toHaveLength(2);
    expect(results.map((item) => (item as { title: string }).title)).toEqual([
      "Design story number 0",
      "Design story number 1",
    ]);
  });

  it("rejects pages without a matching section or article links", async () => {
    const designSource: NordicSourceConfig = { ...source, latestSectionHeading: "Latest stories" };
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml")) return new Response("", { status: 503 });
      return new Response("<h2>Archive</h2><a href='/stories/item'>A sufficiently long title</a>", {
        status: 200,
      });
    });
    await expect(fetchLatestFromSource(designSource)).rejects.toThrow("no article links found");
  });

  it("honors robots.txt disallow rules and denies access when policy cannot be fetched", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: NordicArticleCollector\nDisallow: /", { status: 200 });
      throw new Error(`should not request ${url}`);
    });
    await expect(fetchLatestFromSource(source)).rejects.toThrow(
      "robots.txt could not be read or disallows",
    );

    const otherSource = {
      ...source,
      siteUrl: "https://blocked.test/stories",
      feedUrl: "https://blocked.test/feed.xml",
    };
    fetchMock.mockImplementation(async () => new Response("forbidden", { status: 503 }));
    await expect(fetchLatestFromSource(otherSource)).rejects.toThrow(
      "robots.txt could not be read or disallows",
    );
  });

  it("falls back after a failed feed request and reports unavailable listings", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml")) return new Response("failed", { status: 503 });
      return new Response("failed", { status: 502 });
    });
    await expect(fetchLatestFromSource(source)).rejects.toThrow(
      "RSS/Atom and article listing were unavailable",
    );

    const emptySource = {
      ...source,
      siteUrl: "https://empty.test/stories",
      feedUrl: "https://empty.test/feed.xml",
    };
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (url.endsWith("feed.xml"))
        return new Response(
          "<rss><channel><item><title>Missing link</title></item></channel></rss>",
          { status: 200 },
        );
      return new Response("<main>No articles here.</main>", { status: 200 });
    });
    await expect(fetchLatestFromSource(emptySource)).rejects.toThrow("no article links found");
  });

  it("exports the two configured sources and only uses verified feeds", () => {
    expect(sources.NORDIC_SOURCES.map((item) => item.id)).toEqual([
      "finnish-design-shop",
      "lumene",
    ]);
    expect(sources.NORDIC_SOURCES.find((item) => item.id === "finnish-design-shop")?.feedUrl).toBe(
      null,
    );
    expect(sources.NORDIC_SOURCES.find((item) => item.id === "lumene")?.feedUrl).toBe(
      "https://www.lumene.com/blogs/news.atom",
    );
  });
});
