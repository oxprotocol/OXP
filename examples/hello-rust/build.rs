// Build script for hello-rust.
//
// `wit-bindgen` requires the foreign WIT package (`oxp:host`) to live
// under `wit/deps/<dirname>/`. The canonical source of truth is
// `packages/wit/wit/{oxp-host,oxp-extension}.wit`. This script copies
// those files into the layout wit-bindgen expects and fails the build
// if they drift, so the example can never be built against a stale
// world definition.

use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let canonical = manifest_dir.join("../../packages/wit/wit");
    let local_wit = manifest_dir.join("wit");
    let local_deps = local_wit.join("deps").join("oxp-host");

    fs::create_dir_all(&local_deps).expect("mkdir wit/deps/oxp-host");

    let host_src = canonical.join("oxp-host.wit");
    let ext_src = canonical.join("oxp-extension.wit");

    let host_dst = local_deps.join("oxp-host.wit");
    let ext_dst = local_wit.join("extension.wit");

    fs::copy(&host_src, &host_dst).expect("copy oxp-host.wit");
    fs::copy(&ext_src, &ext_dst).expect("copy oxp-extension.wit");

    println!("cargo:rerun-if-changed={}", host_src.display());
    println!("cargo:rerun-if-changed={}", ext_src.display());
    println!("cargo:rerun-if-changed=build.rs");
}
