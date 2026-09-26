import { getNordicArticlesCached } from "@/lib/db/nordic";
import { getManualCooldownUntil, syncProductionDeployment } from "@/lib/nordic/state";
import FetchButton from "./fetch-button";
import { NewsSection } from "@/components/news/news-section";
import { PageShell } from "@/components/layout/page-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  await syncProductionDeployment();
  const [articles, cooldownUntil] = await Promise.all([
    getNordicArticlesCached(),
    getManualCooldownUntil(),
  ]);

  return (
    <PageShell>
      <section>
        <FetchButton cooldownUntil={cooldownUntil} />
      </section>

      <section>
        <NewsSection articles={articles} />
      </section>
    </PageShell>
  );
}
