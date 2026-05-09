# OXP Phase A security test fixtures

These fixtures intentionally attempt to violate Phase A security controls.
They exist so the policy code can be tested against real bundle inputs in CI
and during manual security review.

**DO NOT publish these to the registry.** They are not real extensions.

| Fixture | Tests |
|---|---|
| [`ui-v1-with-js/`](./ui-v1-with-js/) | TA.5 — `oxp-ui-v1` bundle that smuggles a `.js` file. `oxp pack` and the registry MUST reject it. |
| [`unknown-permission/`](./unknown-permission/) | TA.8 — manifest declares a non-existent capability. MUST reject. |
| [`shell-from-unverified/`](./shell-from-unverified/) | TA.8 — manifest declares `terminal.shell` from an unverified publisher. MUST reject. |

Run the policy tests: `pnpm --filter @oxprotocol/bundle test`.
