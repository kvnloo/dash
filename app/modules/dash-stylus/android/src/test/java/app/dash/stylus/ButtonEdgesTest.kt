package app.dash.stylus
import org.junit.Assert.*
import org.junit.Test
class ButtonEdgesTest {
  @Test fun heldAcrossHoverAndTouchIsOnePress() {
    val edge = ButtonEdges()
    assertNull(edge.sample(false))
    assertEquals(true, edge.sample(true))
    repeat(100) { assertNull(edge.sample(true)) }
    assertEquals(false, edge.sample(false))
    assertNull(edge.sample(false))
    assertEquals(true, edge.sample(true))
  }
}
