//! LSP-style `Content-Length` framing.
//!
//! Wire format (per spec §2):
//! ```text
//! Content-Length: <bytes>\r\n
//! \r\n
//! <utf8 json body of exactly <bytes> bytes>
//! ```
//! Optional `Content-Type` header is accepted and ignored.

use std::io;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub struct FrameReader<R> {
    inner: BufReader<R>,
    buf: Vec<u8>,
}

impl<R: tokio::io::AsyncRead + Unpin> FrameReader<R> {
    pub fn new(inner: R) -> Self {
        Self { inner: BufReader::new(inner), buf: Vec::with_capacity(8 * 1024) }
    }

    /// Read one complete JSON-RPC frame. Returns `Ok(None)` on clean EOF.
    pub async fn read_frame(&mut self) -> io::Result<Option<Vec<u8>>> {
        let mut content_length: Option<usize> = None;
        let mut header_line = String::new();

        loop {
            header_line.clear();
            let n = self.inner.read_line(&mut header_line).await?;
            if n == 0 {
                // EOF before any header → clean shutdown.
                return Ok(None);
            }
            // End of headers.
            if header_line == "\r\n" || header_line == "\n" {
                break;
            }
            let line = header_line.trim_end_matches(['\r', '\n']);
            if let Some(rest) = line.strip_prefix("Content-Length:") {
                content_length = Some(
                    rest.trim()
                        .parse::<usize>()
                        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("bad Content-Length: {e}")))?,
                );
            } else if line.starts_with("Content-Type:") {
                // ignored
            } else if line.is_empty() {
                // tolerate stray blank line
                continue;
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("unknown header line: {line:?}"),
                ));
            }
        }

        let len = content_length
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length"))?;

        self.buf.resize(len, 0);
        self.inner.read_exact(&mut self.buf).await?;
        Ok(Some(self.buf.clone()))
    }
}

pub async fn write_frame<W: tokio::io::AsyncWrite + Unpin>(w: &mut W, body: &[u8]) -> io::Result<()> {
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    w.write_all(header.as_bytes()).await?;
    w.write_all(body).await?;
    w.flush().await?;
    Ok(())
}
