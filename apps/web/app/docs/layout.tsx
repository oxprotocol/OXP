import React from "react";
import { DocsSidebar } from "@/components/docs/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="docs-shell mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-10 py-10">
        <aside className="docs-sidebar-wrap hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
