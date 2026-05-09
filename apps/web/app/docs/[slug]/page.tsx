import Link from "next/link";
import { notFound } from "next/navigation";
import { docSections, getDocBySlug, extractHeadings } from "@/lib/docs";
import { DocBody } from "@/components/docs/DocBody";
import { DocsTOC } from "@/components/docs/DocsTOC";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function generateStaticParams() {
  return docSections.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const title = slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return { title };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) notFound();

  const idx = docSections.findIndex((d) => d.slug === slug);
  const prev = idx > 0 ? docSections[idx - 1] : null;
  const next = idx < docSections.length - 1 ? docSections[idx + 1] : null;
  const headings = extractHeadings(doc.body);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_200px] gap-10">
      <article className="docs-content min-w-0 max-w-3xl">
        <p className="docs-eyebrow text-sm font-medium uppercase tracking-wider mb-3">
          {doc.category}
        </p>
        <h1 className="docs-h1 text-4xl font-bold tracking-tight mb-3">
          {doc.title}
        </h1>
        <p className="docs-lead text-[15px] leading-7 mb-8">{doc.summary}</p>

        <DocBody body={doc.body} />

        {/* Prev / Next */}
        <nav
          className="docs-pager mt-16 grid grid-cols-1 sm:grid-cols-2 gap-3"
          aria-label="Pagination"
        >
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="docs-pager-link group flex flex-col rounded-md border px-4 py-3"
            >
              <span className="text-sm uppercase tracking-wider opacity-70 flex items-center gap-1.5">
                <ArrowLeft className="h-3 w-3" /> Previous
              </span>
              <span className="mt-1 text-base font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/docs/${next.slug}`}
              className="docs-pager-link group flex flex-col rounded-md border px-4 py-3 sm:text-right"
            >
              <span className="text-sm uppercase tracking-wider opacity-70 flex items-center gap-1.5 sm:justify-end">
                Next <ArrowRight className="h-3 w-3" />
              </span>
              <span className="mt-1 text-base font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>

      <div className="docs-toc-wrap hidden xl:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pl-2">
          <DocsTOC headings={headings} />
        </div>
      </div>
    </div>
  );
}
