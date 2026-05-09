package dev.oxp.jetbrains.runtime

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

/**
 * Unit tests for the JetBrains-side `BundleFetcher`. We only cover the
 * `file://` and validation paths here so the suite stays hermetic; the
 * `https://` path is exercised against a real localhost server in the
 * demo script (`hosts/jetbrains/scripts/demo.sh`).
 */
class BundleFetcherTest {
    private val wasmHeader = byteArrayOf(0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00)

    @Test fun `reads file URLs and caches by sha256`(@TempDir cache: Path, @TempDir src: Path) {
        val f = src.resolve("ext.wasm")
        Files.write(f, wasmHeader)
        val a = BundleFetcher.fetch(f.toUri().toString(), cache)
        val b = BundleFetcher.fetch(f.toUri().toString(), cache)
        assertEquals(a.componentPath, b.componentPath)
        assertEquals(a.sha256, b.sha256)
        assertEquals(wasmHeader.size.toLong(), a.size)
        assertTrue(Files.exists(a.componentPath))
    }

    @Test fun `rejects non-wasm payloads`(@TempDir cache: Path, @TempDir src: Path) {
        val f = src.resolve("not-wasm.bin")
        Files.write(f, byteArrayOf(0xff.toByte(), 0xff.toByte(), 0xff.toByte(), 0xff.toByte()))
        val ex = assertThrows(FetchBundleException::class.java) {
            BundleFetcher.fetch(f.toUri().toString(), cache)
        }
        assertEquals("NOT_WASM", ex.code)
    }

    @Test fun `refuses http without opt-in`(@TempDir cache: Path) {
        val ex = assertThrows(FetchBundleException::class.java) {
            BundleFetcher.fetch("http://example.test/x.wasm", cache, allowInsecureHttp = false)
        }
        assertEquals("SCHEME_NOT_ALLOWED", ex.code)
    }

    @Test fun `refuses unknown schemes`(@TempDir cache: Path) {
        val ex = assertThrows(FetchBundleException::class.java) {
            BundleFetcher.fetch("ftp://example.test/x.wasm", cache)
        }
        assertEquals("SCHEME_NOT_ALLOWED", ex.code)
    }

    @Test fun `enforces maxBytes on file path`(@TempDir cache: Path, @TempDir src: Path) {
        val f = src.resolve("big.wasm")
        Files.write(f, ByteArray(1024) { if (it < 4) wasmHeader[it] else 0 })
        val ex = assertThrows(FetchBundleException::class.java) {
            BundleFetcher.fetch(f.toUri().toString(), cache, maxBytes = 16)
        }
        assertEquals("TOO_LARGE", ex.code)
    }
}
