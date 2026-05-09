package dev.oxp.jetbrains.protocol

import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets

/**
 * LSP-style framing: `Content-Length: <n>\r\n\r\n<utf8 json>`.
 *
 * The reader is blocking and intended to run on a dedicated background
 * thread (see [RpcClient.startReader]). It reads bytes — never characters —
 * because the body length is byte-counted per spec.
 */
internal object Framing {
    private const val HEADER_TERMINATOR = "\r\n\r\n"
    private val HEADER_BYTES = HEADER_TERMINATOR.toByteArray(StandardCharsets.US_ASCII)

    fun encode(json: String): ByteArray {
        val body = json.toByteArray(StandardCharsets.UTF_8)
        val header = "Content-Length: ${body.size}\r\n\r\n"
            .toByteArray(StandardCharsets.US_ASCII)
        return header + body
    }

    fun write(out: OutputStream, json: String) {
        out.write(encode(json))
        out.flush()
    }

    /** Blocking read of one frame. Returns null on EOF before any bytes. */
    fun readFrame(input: InputStream): String? {
        val headerBuf = StringBuilder()
        // Read headers byte-by-byte until we see the terminator. Headers are
        // ASCII per LSP spec, so this is safe.
        var matched = 0
        while (matched < HEADER_BYTES.size) {
            val b = input.read()
            if (b == -1) {
                return if (headerBuf.isEmpty()) null
                       else throw RuntimeException("EOF mid-header: $headerBuf")
            }
            val ch = b.toChar()
            headerBuf.append(ch)
            matched = if (b == HEADER_BYTES[matched].toInt()) matched + 1 else 0
        }
        val headers = headerBuf.toString().removeSuffix(HEADER_TERMINATOR)
        val length = headers.lineSequence()
            .firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
            ?.substringAfter(":")
            ?.trim()
            ?.toIntOrNull()
            ?: throw RuntimeException("Missing Content-Length header: $headers")

        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n == -1) throw RuntimeException("EOF mid-body at $read/$length")
            read += n
        }
        return String(body, StandardCharsets.UTF_8)
    }
}
