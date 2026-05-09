import { defineExtension } from "@oxprotocol/sdk";

export default defineExtension({
  async activate(host) {
    host.log("info", "hello from @__PUBLISHER__/__SLUG__");
    host.renderHtml(`
      <div style="font-family:system-ui;padding:2rem;color:#f8fafc;background:#060a13;min-height:100vh;display:grid;place-items:center">
        <div style="border:1px solid rgba(125,211,252,.3);padding:2rem;border-radius:8px;text-align:center">
          <h1 style="margin:0 0 .5rem;font-size:1.5rem">__DISPLAY_NAME__</h1>
          <p style="margin:0;opacity:.6;font-family:ui-monospace,monospace;font-size:.75rem">
            @__PUBLISHER__/__SLUG__
          </p>
        </div>
      </div>
    `);
  },
});
