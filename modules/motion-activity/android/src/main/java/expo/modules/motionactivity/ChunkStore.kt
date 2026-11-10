package expo.modules.motionactivity

import android.content.Context
import java.io.File
import java.io.IOException

internal class SensorSeries {
  val t = ArrayList<Double>(600)
  val x = ArrayList<Float>(600)
  val y = ArrayList<Float>(600)
  val z = ArrayList<Float>(600)

  val size get() = t.size

  fun add(seconds: Double, vx: Float, vy: Float, vz: Float) {
    t.add(seconds); x.add(vx); y.add(vy); z.add(vz)
  }

  fun clear() {
    t.clear(); x.clear(); y.clear(); z.clear()
  }
}

/**
 * One JSON file per captured window in filesDir/motion_chunks, named by start epoch ms so that
 * name order is chronological. Files are written to .tmp and renamed, so readers never see a partial chunk.
 */
internal object ChunkStore {
  private const val DIR_NAME = "motion_chunks"
  private const val MAX_CHUNKS = 2000
  private val SAFE_ID = Regex("^[0-9A-Za-z_-]+$")

  private fun dir(context: Context) = File(context.filesDir, DIR_NAME).apply { mkdirs() }

  private fun chunkFiles(dir: File): List<File> =
    (dir.listFiles { f -> f.name.endsWith(".json") } ?: emptyArray()).sortedBy { it.name }

  fun write(context: Context, startedAtMs: Long, acc: SensorSeries, gyro: SensorSeries?) {
    val dir = dir(context)
    var id = startedAtMs.toString()
    var n = 0
    while (File(dir, "$id.json").exists()) id = "${startedAtMs}_${++n}"

    val json = buildString(acc.size * 80 + (gyro?.size ?: 0) * 80 + 128) {
      append("{\"id\":\"").append(id).append("\",\"startedAtMs\":").append(startedAtMs)
      append(",\"acc\":")
      appendSeries(acc)
      append(",\"gyro\":")
      if (gyro == null) append("null") else appendSeries(gyro)
      append('}')
    }

    val tmp = File(dir, "$id.tmp")
    tmp.writeText(json)
    if (!tmp.renameTo(File(dir, "$id.json"))) {
      tmp.delete()
      throw IOException("Could not save chunk $id")
    }
    enforceCap(dir)
  }

  fun read(context: Context, limit: Int): List<Map<String, String>> =
    chunkFiles(dir(context)).take(limit.coerceAtLeast(0)).mapNotNull { file ->
      try {
        mapOf("id" to file.name.removeSuffix(".json"), "json" to file.readText())
      } catch (e: IOException) {
        null // Deleted concurrently by the cap.
      }
    }

  fun delete(context: Context, ids: List<String>) {
    val dir = dir(context)
    ids.filter { SAFE_ID.matches(it) }.forEach { File(dir, "$it.json").delete() }
  }

  private fun enforceCap(dir: File) {
    val files = chunkFiles(dir)
    if (files.size > MAX_CHUNKS) files.take(files.size - MAX_CHUNKS).forEach { it.delete() }
    // Leftovers from a crash mid-write.
    dir.listFiles { f -> f.name.endsWith(".tmp") }?.forEach { it.delete() }
  }

  private fun StringBuilder.appendSeries(s: SensorSeries) {
    append("{\"t\":"); appendNumbers(s.t)
    append(",\"x\":"); appendNumbers(s.x)
    append(",\"y\":"); appendNumbers(s.y)
    append(",\"z\":"); appendNumbers(s.z)
    append('}')
  }

  private fun StringBuilder.appendNumbers(values: List<Number>) {
    append('[')
    values.forEachIndexed { i, v ->
      if (i > 0) append(',')
      val d = v.toDouble()
      // JSON has no NaN/Infinity.
      if (d.isFinite()) append(v.toString()) else append('0')
    }
    append(']')
  }
}
