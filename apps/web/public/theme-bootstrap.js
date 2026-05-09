/* OXP theme bootstrap.
 * Runs synchronously before paint to set <html class="dark|light"> and
 * prevent a flash-of-wrong-theme. Source of truth lives in
 * components/ui/ThemeToggle.tsx; if you change the storage key there,
 * update this file too. */
(function () {
  try {
    var stored = localStorage.getItem("oxp-theme") || "system";
    var resolved =
      stored === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : stored;
    var root = document.documentElement;
    root.classList.toggle("light", resolved === "light");
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  } catch (e) {}
})();
