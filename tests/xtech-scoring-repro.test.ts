/**
 * Reproduction test: xtech 20件取得→0件スコアリング
 */
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return {
    ...actual,
    db,
    __client: client,
    getLatestPreferenceProfile: vi.fn().mockResolvedValue(null),
  };
});

const mockScoreArticles = vi.fn();
const mockScoreArticle = vi.fn(async (article: any) => ({
  summary: `個別フォールバック: ${article.title}`,
  usefulness: 8,
  ntt_relevance: 9,
  reason: "フォールバックによる個別スコアリング",
}));
vi.mock("@/lib/llm", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
  scoreArticle: (article: any) => mockScoreArticle(article),
  buildPreferencePromptSection: () => "",
}));

import * as dbMod from "@/lib/db";
import { getScoredArticles, deleteLowScoredArticles } from "@/lib/db";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { normalize } from "@/app/api/fetch-news/route";
import type { XtechItem } from "@/lib/news/xtech";
import type { NormalizedArticle } from "@/lib/types";

const XTECH_FIXTURES: XtechItem[] = [
  {
    title: "26年度末開始「SCS評価制度」に脚光　供給網のサイバー対策を客観評価",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301466/",
    description:
      "企業のセキュリティー対策を評価する「SCS評価制度」がサイバーセキュリティー関係者を中心に注目を集めている。",
    date: "2026-07-23T07:06:00+09:00",
  },
  {
    title: "Umiosが販売計画をAIで自動化　時系列基盤モデル採用で精度95％",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301465/",
    description:
      "水産大手のUmiosは2026年6月25日、AIを活用した販売計画の自動作成システムを営業部門で稼働させた。",
    date: "2026-07-23T07:05:00+09:00",
  },
  {
    title: "東急がポイント会員システムを刷新　1年遅れも3年で完遂、内製化へ前進",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301468/",
    description:
      "東急はグループ共通ポイントの会員向けWeb/アプリシステムを刷新した。富士通に外注していた旧システムから内製化を見据えた新システムへ移行した。",
    date: "2026-07-23T07:04:00+09:00",
  },
  {
    title: "ミロク情報が大学のゼミ演習を支援　会計ソフト提供で学生に実務体験を",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301467/",
    description:
      "ミロク情報サービスは同社のクラウド会計ソフトを使ったゼミ演習を多摩大学経営情報学部が開始した。",
    date: "2026-07-23T07:03:00+09:00",
  },
  {
    title: "T＆D系ペット保険会社が基幹系刷新　年間2800時間の業務削減効果",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301464/",
    description:
      "T&Dホールディングス傘下のペット＆ファミリー損害保険は、基幹系システムを全面刷新した。",
    date: "2026-07-23T07:02:00+09:00",
  },
  {
    title: "パナソニック ホールディングス、次世代車載インフォテインメント用OS基盤を共同開発",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301463/",
    description: "パナソニックHDは次世代車載インフォテインメント用OS基盤の共同開発を発表した。",
    date: "2026-07-23T07:01:00+09:00",
  },
  {
    title: "オープンAI、新AIモデル「GPT-4o mini」発表　コスト1/60に",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301462/",
    description: "米OpenAIは新しい軽量AIモデル「GPT-4o mini」を発表した。",
    date: "2026-07-23T07:00:00+09:00",
  },
  {
    title: "生成AIの企業利用、セキュリティリスクとガバナンスの課題",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301461/",
    description: "企業の生成AI利用において、データ漏洩やシャドーAIの管理が重要になっている。",
    date: "2026-07-23T06:59:00+09:00",
  },
  {
    title: "量子コンピューターの実用化に向けた最新動向と暗号技術への影響",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301460/",
    description: "耐量子暗号（PQC）への移行が急ピッチで進められている。",
    date: "2026-07-23T06:58:00+09:00",
  },
  {
    title: "エッジAIの進化と半導体産業の新たな地政学リスク",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301459/",
    description: "低消費電力で動作するエッジAIチップの開発競争が激化している。",
    date: "2026-07-23T06:57:00+09:00",
  },
  {
    title: "クラウドネイティブアーキテクチャの最新プラクティス",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301458/",
    description: "Kubernetesやマイクロサービスの運用効率化に関する事例紹介。",
    date: "2026-07-23T06:56:00+09:00",
  },
  {
    title: "デジタル庁が進める行政システムのクラウド移行とガバメントクラウドの現状",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301457/",
    description: "自治体システムの標準化とガバメントクラウドの活用が進む。",
    date: "2026-07-23T06:55:00+09:00",
  },
  {
    title: "自動運転車におけるLiDARとAIビジョンの融合技術",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301456/",
    description: "レベル4自動運転の実用化に向けたセンサーフュージョン技術の解説。",
    date: "2026-07-23T06:54:00+09:00",
  },
  {
    title: "5Gスタンドアローン（SA）とローカル5Gの企業活用シナリオ",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301455/",
    description: "スマートファクトリーや遠隔医療におけるローカル5Gの導入事例。",
    date: "2026-07-23T06:53:00+09:00",
  },
  {
    title: "ブロックチェーン技術を活用したサプライチェーンの透明化",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301454/",
    description: "トレーサビリティ確保のためのブロックチェーン活用が進展。",
    date: "2026-07-23T06:52:00+09:00",
  },
  {
    title: "サステナブルIT：データセンターの省電力化と液浸冷却技術",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301453/",
    description: "AIサーバーの発熱問題に対応する液浸冷却システムの導入が加速。",
    date: "2026-07-23T06:51:00+09:00",
  },
  {
    title: "フィンテックの未来：embedded finance（組み込み型金融）の拡大",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301452/",
    description: "非金融企業による決済や融資サービスの組み込みが日常化へ。",
    date: "2026-07-23T06:50:00+09:00",
  },
  {
    title: "バイオメトリクス認証の高度化とパスワードレス社会の到来",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301451/",
    description: "生体認証とパスキーの普及による認証セキュリティの劇的な向上。",
    date: "2026-07-23T06:49:00+09:00",
  },
  {
    title: "スマートシティにおけるIoTプラットフォームとデータ連携基盤",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301450/",
    description: "都市インフラの効率化と住民サービス向上のためのデジタルツイン構築。",
    date: "2026-07-23T06:48:00+09:00",
  },
  {
    title: "次世代Web3と分散型ID（DID）のビジネスインパクト",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301449/",
    description: "自己主権型アイデンティティと次世代インターネットの可能性。",
    date: "2026-07-23T06:47:00+09:00",
  },
];

const ARTICLE_COUNT = XTECH_FIXTURES.length;
const ARTICLES_WITH_ZENKAKU_COUNT = XTECH_FIXTURES.length;

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL UNIQUE,
    url_to_image TEXT,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_id TEXT,
    author TEXT,
    keyword TEXT,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
  mockScoreArticles.mockReset();
});

describe("xtech 20件取得→0件スコアリングの完全再現テスト", () => {
  it("XtechFixture から正規化された20件の記事が正しくスコアリング・保存され、スコア付きで取得できる", async () => {
    const normalized: NormalizedArticle[] = XTECH_FIXTURES.map((item) => normalize(item, "xtech"));

    expect(normalized).toHaveLength(ARTICLE_COUNT);
    for (const a of normalized) {
      expect(a.sourceId).toBe("xtech");
      expect(a.sourceName).toBe("日経クロステック");
      expect(a.title).toBeTruthy();
      expect(a.url).toBeTruthy();
      expect(a.publishedAt).toBeTruthy();
    }

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => ({
          summary: `要約: ${item.title.slice(0, 20)}`,
          usefulness: 9,
          ntt_relevance: 8,
          reason: "日経クロステックのIT記事として有用",
        })),
    );

    const since = new Date().toISOString();
    let saved: number | undefined;
    let pipelineError: any;

    try {
      saved = await scoreAndSaveTagged(normalized);
      await deleteLowScoredArticles(5, since);
    } catch (err) {
      pipelineError = err;
    }

    expect(pipelineError).toBeUndefined();
    expect(saved).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100, "xtech");
    expect(scored.length).toBe(ARTICLE_COUNT);

    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.score).toBeGreaterThan(0);
      expect(a.summary).toBeTruthy();
      expect(a.sourceId).toBe("xtech");
      expect(a.sourceName).toBe("日経クロステック");
    }
  });

  it("descriptionがnullでもパイプラインが正常動作する", async () => {
    const articlesWithNullDesc: NormalizedArticle[] = XTECH_FIXTURES.map((a) => ({
      ...normalize(a, "xtech"),
      description: null,
    }));

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "要約テスト",
          usefulness: 7,
          ntt_relevance: 8,
          reason: "OK",
        })),
    );

    const saved = await scoreAndSaveTagged(articlesWithNullDesc);

    expect(saved).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100, "xtech");
    expect(scored.length).toBe(ARTICLE_COUNT);
  });

  it("descriptionが空文字でもパイプラインが正常動作する", async () => {
    const articlesWithEmptyDesc: NormalizedArticle[] = XTECH_FIXTURES.map((a) => ({
      ...normalize(a, "xtech"),
      description: "",
    }));

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "要約テスト",
          usefulness: 7,
          ntt_relevance: 8,
          reason: "OK",
        })),
    );

    const saved = await scoreAndSaveTagged(articlesWithEmptyDesc);

    expect(saved).toBe(ARTICLE_COUNT);
  });

  it("xtech特有のタイムゾーン付き日付でもcalcRecencyScoreが正常動作する", async () => {
    const { calcRecencyScore } = await import("@/lib/scoring");

    const now = new Date();
    const jstDate =
      now.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(" ", "T") + "+09:00";

    const score = calcRecencyScore(jstDate);
    expect(score).toBeGreaterThanOrEqual(8);

    const oldScore = calcRecencyScore("2026-01-01T00:00:00+09:00");
    expect(oldScore).toBe(0);
  });

  it("descriptionに全角スペースが先頭にあっても正常処理される", async () => {
    const articlesWithZenkakuDesc: NormalizedArticle[] = XTECH_FIXTURES.map((a, i) => ({
      ...normalize(a, "xtech"),
      description: `　${a.description ?? ""}`,
      url: `https://xtech.nikkei.com/test/${i}/unique`,
    }));

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "全角スペーステスト",
          usefulness: 6,
          ntt_relevance: 8,
          reason: "OK",
        })),
    );

    const saved = await scoreAndSaveTagged(articlesWithZenkakuDesc);

    expect(saved).toBe(ARTICLES_WITH_ZENKAKU_COUNT);
  });

  it("LLMバッチが全nullを返した場合、savedCount=0", async () => {
    mockScoreArticles.mockResolvedValue([null, null]);

    const articles: NormalizedArticle[] = [
      normalize(XTECH_FIXTURES[0], "xtech"),
      normalize(XTECH_FIXTURES[1], "xtech"),
    ];
    articles[0].url = "https://xtech.nikkei.com/fallback/1";
    articles[1].url = "https://xtech.nikkei.com/fallback/2";

    const saved = await scoreAndSaveTagged(articles);

    expect(saved).toBe(0);
  });
});
