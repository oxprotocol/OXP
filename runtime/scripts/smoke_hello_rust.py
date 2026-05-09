#!/usr/bin/env python3
"""End-to-end smoke test: load + activate + command + deactivate the
real hello_rust.wasm component through the oxp-runtime binary."""
import subprocess, json, os, sys

WASM = os.path.abspath(
    os.path.join(os.path.dirname(__file__),
                 "../../examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm"))
assert os.path.exists(WASM), WASM

def frame(o):
    b = json.dumps(o).encode()
    return f"Content-Length: {len(b)}\r\n\r\n".encode() + b

env = os.environ.copy()
env["OXP_LOG"] = "info,oxp::ext=info"
p = subprocess.Popen(
    ["./target/debug/oxp-runtime", "--host", "piye"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
)

def rd():
    h = b""
    while not h.endswith(b"\r\n\r\n"):
        c = p.stdout.read(1)
        if not c:
            return None
        h += c
    ln = int([x for x in h.decode().split("\r\n")
              if x.lower().startswith("content-length:")][0].split(":")[1])
    return json.loads(p.stdout.read(ln))

def send(o):
    p.stdin.write(frame(o)); p.stdin.flush()

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
    "protocolVersion":"1.0",
    "host":{"id":"piye","version":"0.0.1","platform":"darwin-arm64"},
    "capabilities":{"ui":{"statusBar":True}},
    "hostStorePath":"/tmp/oxp-store"}})
print("init:", rd())

send({"jsonrpc":"2.0","id":2,"method":"extension/load","params":{
    "extensionId":"@aldgar/hello","version":"0.1.0",
    "bundlePath":WASM, "surfacesRequired":["ui.statusBar"]}})
load = rd(); print("load:", load)
inst = load["result"]["instanceId"]

send({"jsonrpc":"2.0","id":3,"method":"extension/activate","params":{"instanceId":inst}})
print("activate:", rd())

send({"jsonrpc":"2.0","id":4,"method":"extension/command","params":{
    "instanceId":inst,"commandId":"hello.greet","argsJson":"{\"name\":\"world\"}"}})
print("command:", rd())

send({"jsonrpc":"2.0","id":5,"method":"extension/deactivate","params":{"instanceId":inst}})
print("deactivate:", rd())

send({"jsonrpc":"2.0","id":99,"method":"shutdown"}); print("shutdown:", rd())
send({"jsonrpc":"2.0","method":"exit"})
try: p.stdin.close()
except Exception: pass
p.wait(timeout=5)
print("=== exit:", p.returncode, "===")
print("--- stderr ---")
sys.stdout.write(p.stderr.read().decode(errors="replace"))
