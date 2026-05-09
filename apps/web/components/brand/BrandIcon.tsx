/* Inline SVG brand marks for the IDE marquee on the landing page.
   Each icon renders at the parent's color via `currentColor`, so the
   marquee can recolor everything uniformly (Neon-style monochrome row). */

import type { SVGProps } from "react";

export type BrandIconName =
  | "vscode"
  | "cursor"
  | "windsurf"
  | "jetbrains"
  | "neovim";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function VSCode(props: IconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      {...props}
    >
      <title>{props.title ?? "VS Code"}</title>
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896Z" />
    </svg>
  );
}

function JetBrains(props: IconProps) {
  // simple-icons/simple-icons (CC0) — icons/jetbrains.svg
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <title>{props.title ?? "JetBrains"}</title>
      <path d="M2.345 23.997A2.347 2.347 0 0 1 0 21.652V10.988C0 9.665.535 8.37 1.473 7.433l5.965-5.961A5.01 5.01 0 0 1 10.989 0h10.666A2.347 2.347 0 0 1 24 2.345v10.664a5.056 5.056 0 0 1-1.473 3.554l-5.965 5.965A5.017 5.017 0 0 1 13.007 24v-.003H2.345Zm8.969-6.854H5.486v1.371h5.828v-1.371ZM3.963 6.514h13.523v13.519l4.257-4.257a3.936 3.936 0 0 0 1.146-2.767V2.345c0-.678-.552-1.234-1.234-1.234H10.989a3.897 3.897 0 0 0-2.767 1.145L3.963 6.514Zm-.192.192L2.256 8.22a3.944 3.944 0 0 0-1.145 2.768v10.664c0 .678.552 1.234 1.234 1.234h10.666a3.9 3.9 0 0 0 2.767-1.146l1.512-1.511H3.771V6.706Z" />
    </svg>
  );
}

function Neovim(props: IconProps) {
  // simpleicons neovim path
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <title>{props.title ?? "Neovim"}</title>
      <path d="M2.214 4.954v14.091L7.99 24V12.062L18.044 24h3.491l.252-.291V4.954L15.978 0v11.844L6.038 0z M2.886 5.34l4.428 3.715v13.501l-4.428-3.769zm17.685.046v13.43l-3.815 3.299V8.708z" />
    </svg>
  );
}

function Cursor(props: IconProps) {
  // simple-icons/simple-icons (CC0) — icons/cursor.svg
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <title>{props.title ?? "Cursor"}</title>
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  );
}

function Windsurf(props: IconProps) {
  // simple-icons/simple-icons (CC0) — icons/windsurf.svg
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <title>{props.title ?? "Windsurf"}</title>
      <path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z" />
    </svg>
  );
}

const REGISTRY: Record<BrandIconName, (p: IconProps) => React.JSX.Element> = {
  vscode: VSCode,
  cursor: Cursor,
  windsurf: Windsurf,
  jetbrains: JetBrains,
  neovim: Neovim,
};

export function BrandIcon({
  name,
  className,
  ...rest
}: IconProps & { name: BrandIconName }) {
  const Icon = REGISTRY[name];
  return <Icon className={className} {...rest} />;
}
