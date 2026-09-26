export interface NordicCandidate {
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  description: string | null;
  urlToImage: string | null;
  publishedAt: string;
}

export interface NordicScore {
  summary: string;
  nordicRelevance: number;
  reason: string;
}

export interface NordicArticleInput extends NordicCandidate {
  id?: number;
}
