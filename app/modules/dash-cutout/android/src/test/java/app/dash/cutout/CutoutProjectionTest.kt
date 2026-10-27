package app.dash.cutout

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CutoutProjectionTest {
  @Test fun convertsPxToDipOnce() {
    // A centred punch-hole at density 3.5 (values are a fixture, not a device constant).
    val out = CutoutProjection.project(listOf(intArrayOf(672, 28, 768, 124)), 3.5f, 1440, 3120, 124, 140, 0)!!
    @Suppress("UNCHECKED_CAST")
    val rect = (out["rects"] as List<Map<String, Double>>).single()
    assertEquals(192.0, rect["x"]!!, 0.001)
    assertEquals(8.0, rect["y"]!!, 0.001)
    assertEquals(27.43, rect["width"]!!, 0.001)
    assertEquals(27.43, rect["height"]!!, 0.001)
    assertEquals(411.43, out["windowWidth"] as Double, 0.001)
    assertEquals(35.43, out["safeInsetTop"] as Double, 0.001)
    assertEquals(40.0, out["statusBarTop"] as Double, 0.001)
    assertEquals(true, out["supported"])
  }

  @Test fun dropsEmptyRectsAndKeepsRotation() {
    val out = CutoutProjection.project(listOf(intArrayOf(5, 5, 5, 40), intArrayOf(0, 0, 10, 10)), 2f, 800, 400, 0, 0, 1)!!
    assertEquals(1, (out["rects"] as List<*>).size)
    assertEquals(1, out["rotation"])
  }

  @Test fun rejectsUnmeasuredWindow() {
    assertNull(CutoutProjection.project(emptyList(), 3f, 0, 100, 0, 0, 0))
    assertNull(CutoutProjection.project(emptyList(), 0f, 100, 100, 0, 0, 0))
  }
}
