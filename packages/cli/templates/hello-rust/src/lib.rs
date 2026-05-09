// Hello-world OXP extension component, written in Rust.
//
// Exercises:
//   * activate / deactivate lifecycle exports
//   * a single always-on host import: oxp:host/log
//
// To build:
//   rustup target add wasm32-wasip2
//   cargo build --release --target wasm32-wasip2
//   mkdir -p build && cp target/wasm32-wasip2/release/__SLUG_UNDERSCORED__.wasm build/
//   oxp pack

wit_bindgen::generate!({
    world: "extension",
    path: "wit",
    generate_all,
});

use exports::oxp::extension::command_handler::Guest as CommandHandlerGuest;
use exports::oxp::extension::lifecycle::{ActivateCtx, Guest as LifecycleGuest};
use exports::oxp::extension::ui_handler::{EventError, Guest as UiHandlerGuest};
use oxp::host::log::{log, Level};

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
        Ok(())
    }

    fn deactivate() -> Result<(), String> {
        log(Level::Info, "goodbye");
        Ok(())
    }
}

impl UiHandlerGuest for Component {
    fn on_event(_event: Vec<u8>) -> Result<(), EventError> {
        Ok(())
    }
}

impl CommandHandlerGuest for Component {
    fn on_command(id: String, args_json: String) -> Result<String, String> {
        match id.as_str() {
            // Replace this with your own command. The result must be valid JSON.
            "hello.greet" => {
                let name = parse_json_string_field(&args_json, "name")
                    .unwrap_or_else(|| "world".to_string());
                Ok(format!("\"hello, {}!\"", json_escape(&name)))
            }
            other => Ok(format!("\"unhandled:{}\"", other)),
        }
    }
}

// Tiny zero-dependency JSON helpers so the template doesn't pull in serde
// just for one example. Replace with serde_json once your extension grows.
fn parse_json_string_field(json: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\"");
    let start = json.find(&needle)? + needle.len();
    let rest = &json[start..];
    let colon = rest.find(':')? + 1;
    let after_colon = &rest[colon..];
    let q = after_colon.find('"')? + 1;
    let body = &after_colon[q..];
    let mut out = String::new();
    let mut chars = body.chars();
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
