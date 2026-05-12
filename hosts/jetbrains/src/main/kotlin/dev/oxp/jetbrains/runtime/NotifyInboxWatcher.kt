package dev.oxp.jetbrains.runtime

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardWatchEventKinds
import java.nio.file.WatchService
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong

/**
 * Tails `<oxpHome>/notify/inbox.jsonl` and dispatches every new line as
 * a [NotifyEvent] to registered listeners. The CLI's `broadcast()` helper
 * appends to this file from every host process, so anything the user does
 * in a terminal (`oxp install …`, `oxp uninstall …`) shows up here.
 *
 * Mirrors `oxp/hosts/vscode/src/extension.ts:startNotifyWatcher`. We only
 * care about *new* events — the file may be huge with backlog from past
 * sessions, so we start reading at `file.size` on first init.
 */
class NotifyInboxWatcher(
    private val oxpHome: Path = InstalledStoreReader.defaultOxpHome(),
) : Disposable {
    private val log = Logger.getInstance(NotifyInboxWatcher::class.java)
    private val json = Json { ignoreUnknownKeys = true }
    private val listeners = CopyOnWriteArrayList<(NotifyEvent) -> Unit>()
    private val lastSize = AtomicLong(0)

    @Volatile private var watchService: WatchService? = null
    @Volatile private var thread: Thread? = null
    @Volatile private var stopped = false

    val inboxFile: Path = oxpHome.resolve("notify").resolve("inbox.jsonl")

    data class NotifyEvent(
        val kind: String,
        val id: String?,
        val version: String?,
    )

    fun addListener(l: (NotifyEvent) -> Unit): () -> Unit {
        listeners.add(l); return { listeners.remove(l) }
    }

    fun start() {
        if (thread != null) return
        try {
            Files.createDirectories(inboxFile.parent)
        } catch (_: Exception) { /* permission issue — degrade silently */ }
        // Seed lastSize so we don't replay the backlog.
        lastSize.set(try { if (Files.isRegularFile(inboxFile)) Files.size(inboxFile) else 0L } catch (_: Exception) { 0L })

        val ws = try {
            val s = inboxFile.fileSystem.newWatchService()
            inboxFile.parent.register(s,
                StandardWatchEventKinds.ENTRY_MODIFY,
                StandardWatchEventKinds.ENTRY_CREATE)
            s
        } catch (e: Exception) {
            log.info("notify watcher: WatchService unavailable, falling back to polling: ${e.message}")
            null
        }
        watchService = ws

        thread = Thread({
            if (ws != null) loopWatch(ws) else loopPoll()
        }, "oxp-notify-watcher").apply {
            isDaemon = true
            start()
        }
    }

    private fun loopWatch(ws: WatchService) {
        while (!stopped) {
            val key = try { ws.take() } catch (_: InterruptedException) { return } catch (_: Exception) { return }
            for (ev in key.pollEvents()) {
                val ctx = ev.context()?.toString() ?: continue
                if (ctx == "inbox.jsonl") drain()
            }
            if (!key.reset()) break
        }
    }

    private fun loopPoll() {
        while (!stopped) {
            try { Thread.sleep(2000) } catch (_: InterruptedException) { return }
            drain()
        }
    }

    private fun drain() {
        try {
            if (!Files.isRegularFile(inboxFile)) return
            val size = Files.size(inboxFile)
            val from = lastSize.get()
            if (size <= from) {
                lastSize.set(size); return
            }
            val bytes = Files.newByteChannel(inboxFile).use { ch ->
                ch.position(from)
                val buf = java.nio.ByteBuffer.allocate((size - from).toInt())
                while (buf.hasRemaining()) {
                    if (ch.read(buf) <= 0) break
                }
                buf.array().copyOf(buf.position())
            }
            lastSize.set(size)
            String(bytes, Charsets.UTF_8).split('\n').forEach { line ->
                val trimmed = line.trim()
                if (trimmed.isEmpty()) return@forEach
                val ev = parse(trimmed) ?: return@forEach
                listeners.forEach { l ->
                    try { l(ev) } catch (e: Exception) { log.warn("notify listener threw", e) }
                }
            }
        } catch (e: Exception) {
            log.debug("notify drain failed", e)
        }
    }

    private fun parse(line: String): NotifyEvent? = try {
        val o: JsonObject = json.parseToJsonElement(line).let {
            if (it is JsonObject) it else return null
        }
        val kind = o["kind"]?.jsonPrimitive?.contentOrNull ?: return null
        NotifyEvent(
            kind = kind,
            id = o["id"]?.jsonPrimitive?.contentOrNull,
            version = o["version"]?.jsonPrimitive?.contentOrNull,
        )
    } catch (_: SerializationException) { null } catch (_: Exception) { null }

    override fun dispose() {
        stopped = true
        try { watchService?.close() } catch (_: Exception) {}
        thread?.interrupt()
    }
}
