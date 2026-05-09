import type { Metadata } from "next";

export const metadata: Metadata = { title: "MCP" };

export default function McpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
