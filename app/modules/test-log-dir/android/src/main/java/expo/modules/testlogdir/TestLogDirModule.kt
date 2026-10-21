package expo.modules.testlogdir

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Dev test log files in the app's external files dir
// (Android/data/<package>/files), which adb can pull without root or
// permissions. expo-file-system writes outside the sandbox only into paths
// that already exist, so the log needs these few calls. Every path must stay
// inside that dir.
class TestLogDirModule : Module() {
  private fun baseDir(): File =
    appContext.reactContext?.getExternalFilesDir(null)
      ?: throw IllegalStateException("external files dir unavailable")

  private fun inside(path: String): File {
    val base = baseDir().canonicalPath + File.separator
    val file = File(path).canonicalFile
    if (!file.path.startsWith(base)) {
      throw IllegalArgumentException("path outside the external files dir")
    }
    return file
  }

  override fun definition() = ModuleDefinition {
    Name("TestLogDir")

    // Creates <external files dir>/<name> and returns its absolute path.
    Function("directory") { name: String ->
      val dir = File(baseDir(), name)
      if (!dir.isDirectory && !dir.mkdirs()) {
        throw IllegalStateException("cannot create the test log dir")
      }
      dir.absolutePath
    }

    Function("append") { path: String, text: String ->
      inside(path).appendText(text)
    }

    // 0 for a missing file
    Function("size") { path: String ->
      inside(path).length().toDouble()
    }

    Function("read") { path: String ->
      val file = inside(path)
      if (file.isFile) file.readText() else ""
    }

    Function("list") { path: String ->
      inside(path).list()?.sorted() ?: emptyList<String>()
    }
  }
}
