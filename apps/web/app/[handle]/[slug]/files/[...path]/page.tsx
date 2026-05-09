import { notFound } from "next/navigation";
import { CommitStrip } from "@/components/repo/CommitStrip";
import { DirListing, FileBreadcrumbs } from "@/components/repo/FileTree";
import { FileViewer } from "@/components/repo/FileViewer";
import {
  getRepoFile,
  getRepoTree,
  isRepoDirectory,
  listRepoDirectory,
} from "@/lib/repos";

export default async function RepoFilesPathPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string; path: string[] }>;
}) {
  const { handle, slug, path } = await params;
  const joined = path.join("/");

  const tree = getRepoTree(handle, slug);
  if (!tree) notFound();

  const isDir = isRepoDirectory(handle, slug, joined);
  const file = isDir ? undefined : getRepoFile(handle, slug, joined);

  if (!isDir && !file) notFound();

  return (
    <section className="app-container app-shell py-12 space-y-4">
      <FileBreadcrumbs ownerHandle={handle} slug={slug} segments={path} />

      {isDir ? (
        <>
          <CommitStrip tree={tree} />
          <DirListing
            ownerHandle={handle}
            slug={slug}
            parentPath={joined}
            entries={listRepoDirectory(handle, slug, joined)}
          />
        </>
      ) : (
        file && <FileViewer file={file} />
      )}
    </section>
  );
}
