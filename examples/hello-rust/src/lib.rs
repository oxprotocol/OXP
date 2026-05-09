// Minimal OXP extension component, written in Rust.
//
// This is the canonical "hello world" smoke test for the
// `@oxprotocol/host-runtime` jco backend. It exercises:
//   * activate / deactivate lifecycle exports
//   * a single always-on host import: oxp:host/log
//
// It deliberately does NOT touch fs/net/secrets/commands so the
// linker can drop those imports — the resulting .wasm only requires
// log, storage, and ui bindings (the always-on set).

wit_bindgen::generate!({
    world: "extension",
    path: "wit",
    generate_all,
});

use exports::oxp::extension::lifecycle::{ActivateCtx, Guest as LifecycleGuest};
use exports::oxp::extension::ui_handler::{EventError, Guest as UiHandlerGuest};
use exports::oxp::extension::command_handler::Guest as CommandHandlerGuest;
use oxp::host::log::{log, Level};
use oxp::host::ui;

use std::cell::{Cell, RefCell};

thread_local! {
    /// Click counter — demonstrates state surviving between events and
    /// re-renders. Single-threaded wasm so a Cell is plenty.
    static CLICKS: Cell<u32> = const { Cell::new(0) };
    /// Host name remembered from activate — used to keep the title stable
    /// across re-renders.
    static HOST: RefCell<String> = const { RefCell::new(String::new()) };
}

fn render_ui() {
    let n = CLICKS.with(|c| c.get());
    let host_name = HOST.with(|h| h.borrow().clone());
    let tree = format!(
        r#"{{
            "kind": "box",
            "layout": "column",
            "gap": 8,
            "padding": 12,
            "children": [
                {{ "kind": "text", "content": "hello, {host}!", "size": "lg", "weight": "bold" }},
                {{ "kind": "text", "content": "This UI is rendered by the wasm component, not the IDE.", "color": "muted" }},
                {{ "kind": "divider" }},
                {{ "kind": "text", "content": "Click count: {n}" }},
                {{ "kind": "button", "id": "bump", "label": "+1" }}
            ]
        }}"#,
        host = json_escape(&host_name),
    );
    ui::render(tree.as_bytes());
}

struct Component;

impl LifecycleGuest for Component {
    fn activate(ctx: ActivateCtx) -> Result<(), String> {
        log(
            Level::Info,
            &format!(
                "hello from {} v{} on host {} ({})",
                ctx.extension_id, ctx.version, ctx.host, ctx.host_version
            ),
        );
        HOST.with(|h| *h.borrow_mut() = ctx.host.clone());
        render_ui();
        Ok(())
    }

    fn deactivate() -> Result<(), String> {
        log(Level::Info, "goodbye");
        Ok(())
    }
}

impl UiHandlerGuest for Component {
    fn on_event(event: Vec<u8>) -> Result<(), EventError> {
        // Payload is a JSON UiEvent string; we only care about clicks on
        // the "bump" button. Anything else is silently ignored.
        let text = std::str::from_utf8(&event).unwrap_or("");
        let id = parse_json_string_field(text, "id");
        let typ = parse_json_string_field(text, "type");
        if typ.as_deref() == Some("click") && id.as_deref() == Some("bump") {
            CLICKS.with(|c| c.set(c.get() + 1));
            render_ui();
        }
        Ok(())
    }
}

impl CommandHandlerGuest for Component {
    fn on_command(id: String, args_json: String) -> Result<String, String> {
        match id.as_str() {
            "hello.greet" => {
                // Tiny zero-dep parser: pull out the value of the `name`
                // string field. Avoids pulling serde into the wasm binary
                // just for one example.
                let name = parse_json_string_field(&args_json, "name").unwrap_or_else(|| "world".to_string());
                log(Level::Info, &format!("hello.greet name={name}"));
                // Return value is a JSON string literal so the host
                // can surface it directly.
                Ok(format!("\"hello, {}!\"", json_escape(&name)))
            }
            other => Ok(format!("\"unhandled:{}\"", other)),
        }
    }
}

fn parse_json_string_field(json: &str, field: &str) -> Option<String> {
    // Minimal scanner: find `"<field>"` then the next `"..."`.
    let needle = format!("\"{field}\"");
    let start = json.find(&needle)? + needle.len();
    let rest = &json[start..];
    let colon = rest.find(':')? + 1;
    let after_colon = &rest[colon..];
    let q = after_colon.find('"')? + 1;
    let body = &after_colon[q..];
    // Walk until unescaped closing quote.
    let mut out = String::new();
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next()? {
                'n' => out.push('\n'),
                't' => out.push('\t'),
                'r' => out.push('\r'),
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                other => out.push(other),
            }
        } else if c == '"' {
            return Some(out);
        } else {
            out.push(c);
        }
    }
    None
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

export!(Component);
