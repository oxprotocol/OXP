//! Tiny CLI parser. Avoids a `clap` dependency for a 3-flag binary.

use anyhow::{Context, Result, bail};

#[derive(Debug)]
pub struct Args {
    pub host: String,
    pub rpc: String,
}

impl Args {
    pub fn parse() -> Self {
        match Self::try_parse() {
            Ok(a) => a,
            Err(e) => {
                eprintln!("oxp-runtime: {e}\n\n{}", USAGE);
                std::process::exit(2);
            }
        }
    }

    fn try_parse() -> Result<Self> {
        let mut host: Option<String> = None;
        let mut rpc: Option<String> = Some("stdio".into());
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--host" => host = Some(it.next().context("--host needs a value")?),
                "--rpc" => rpc = Some(it.next().context("--rpc needs a value")?),
                "-h" | "--help" => {
                    println!("{USAGE}");
                    std::process::exit(0);
                }
                "-V" | "--version" => {
                    println!("oxp-runtime {}", env!("CARGO_PKG_VERSION"));
                    std::process::exit(0);
                }
                other => bail!("unknown argument: {other}"),
            }
        }
        let host = host.context("--host <id> is required")?;
        let rpc = rpc.expect("default set above");
        if rpc != "stdio" {
            bail!("only --rpc stdio is supported in v1");
        }
        Ok(Self { host, rpc })
    }
}

const USAGE: &str = "\
Usage: oxp-runtime --host <id> [--rpc stdio]

Required:
  --host <id>     Identifier of the host plugin spawning this process
                  (vscode | cursor | windsurf | vscodium | jetbrains | zed | neovim | piye | cli)

Optional:
  --rpc <kind>    Transport. Only 'stdio' is supported in v1. (default: stdio)
  -V, --version   Print version and exit
  -h, --help      Print this help and exit
";
