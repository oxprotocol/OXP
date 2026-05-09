package dev.oxp.jetbrains.runtime

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.time.Duration

/**
 * Raw `.wasm` fetcher for the "Install from URL" flow. Mirrors the
 * Node-side `fetchBundle` helper in `@oxprotocol/host-core`.
 *
 * Schemes supported:
 *   - `file:` always
 *   - `https:` always
 *   - `http:` only when [allowInsecureHttp] is true (used for localhost demos)
 *
 * Validates wasm magic bytes and caches by sha256 under [cacheDir].
 */
class FetchBundleException(message: String, val code: String) : RuntimeException(message)

data class FetchedBundle(
    val componentPath: Path,
    val sha256: String,
    val size: Long,
    val sourceUrl: String,
)

object BundleFetcher {
    private val WASM_MAGIC = byteArrayOf(0x00, 0x61, 0x73, 0x6d)
    private const val DEFAULT_MAX: Long = 64L * 1024 * 1024

    fun fetch(
        rawUrl: String,
        cacheDir: Path,
        allowInsecureHttp: Boolean = false,
        maxBytes: Long = DEFAULT_MAX,
        onProgress: ((received: Long, total: Long?) -> Unit)? = null,
    ): FetchedBundle {
        val uri = try { URI(rawUrl) } catch (e: Exception) {
            throw FetchBundleException("not a valid URL: $rawUrl", "BAD_URL")
        }
        val scheme = uri.scheme?.lowercase()

        val bytes: ByteArray = when (scheme) {
            "file" -> {
                val p = Path.of(uri)
                val sz = Files.size(p)
                if (sz > maxBytes) throw FetchBundleException("file too large: $sz > $maxBytes", "TOO_LARGE")
                val b = Files.readAllBytes(p)
                onProgress?.invoke(b.size.toLong(), b.size.toLong())
                b
            }
            "https", "http" -> {
                if (scheme == "http" && !allowInsecureHttp) {
                    throw FetchBundleException("scheme not allowed: $scheme", "SCHEME_NOT_ALLOWED")
                }
                val client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(15))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build()
                val req = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofMinutes(2))
                    .header("User-Agent", "OXP-JetBrains-Host/0.1")
                    .GET().build()
                val resp = client.send(req, HttpResponse.BodyHandlers.ofByteArray())
                if (resp.statusCode() !in 200..299) {
                    throw FetchBundleException("fetch $rawUrl → HTTP ${resp.statusCode()}", "FETCH_FAILED")
                }
                val body = resp.body()
                if (body.size.toLong() > maxBytes) {
                    throw FetchBundleException("body ${body.size} > $maxBytes", "TOO_LARGE")
                }
                onProgress?.invoke(body.size.toLong(), body.size.toLong())
                body
            }
            else -> throw FetchBundleException("scheme not allowed: $scheme", "SCHEME_NOT_ALLOWED")
        }

        if (bytes.size < 4 || bytes[0] != WASM_MAGIC[0] || bytes[1] != WASM_MAGIC[1] ||
            bytes[2] != WASM_MAGIC[2] || bytes[3] != WASM_MAGIC[3]
        ) {
            throw FetchBundleException("not a wasm component (bad magic): $rawUrl", "NOT_WASM")
        }

        val sha = sha256Hex(bytes)
        Files.createDirectories(cacheDir)
        val out = cacheDir.resolve("$sha.wasm")
        if (!Files.exists(out) || Files.size(out) != bytes.size.toLong()) {
            Files.write(out, bytes,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE)
        }
        return FetchedBundle(out, sha, bytes.size.toLong(), uri.toString())
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        val sb = StringBuilder(digest.size * 2)
        for (b in digest) {
            val v = b.toInt() and 0xff
            sb.append(Character.forDigit(v ushr 4, 16))
            sb.append(Character.forDigit(v and 0x0f, 16))
        }
        return sb.toString()
    }
}
