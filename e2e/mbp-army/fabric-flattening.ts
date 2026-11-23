import type { Page } from 'playwright/test';

/**
 * Fabric view flattening of a screen's root host View.
 *
 * The army drives the web build, where every React Native View is a DOM node. On the phone, Fabric
 * flattens a View away (no native view; its children mount straight into the nearest real
 * ancestor) unless one of its props needs a native view. When a re-render flips that decision on a
 * mounted View, Fabric has to create or delete the native view and re-parent every child in the
 * same mount batch. Doing that to a screen root while react-native-screens swaps screens crashed
 * the S25 with `addViewAt: failed to insert view [370] into parent [372] at index 1` when the gear
 * opened Settings over Chats in Blueprint (DA-095): the Blueprint screen root is transparent, so
 * flattened, while focused, and gains `opacity: 0`, so a real view, once another screen covers it.
 *
 * `flatteningOf` reads the authored React props of the root View of the innermost screen component
 * rendered for `route` (found from a node inside it) and decides `formsView` with the rules of
 * React Native 0.86's `ViewShadowNode::initialize` and its Android
 * `HostPlatformViewTraitsInitializer` (ReactCommon/react/renderer/components/view). It lists the
 * props behind the decision, so a failure says why.
 */
export type Flattening = { route: string; formsView: boolean; reasons: string[] };

export function flatteningOf(page: Page, route: string, inside: string): Promise<Flattening> {
  return page.getByTestId(inside).first().evaluate((node, route) => {
    type Fiber = { type: unknown; memoizedProps: Record<string, unknown> | null; return: Fiber | null; child: Fiber | null };
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw Error('no React fiber on the probe node');
    let fiber: Fiber | null = Reflect.get(node, fiberKey);
    const routeName = (f: Fiber) => {
      const r = f.memoizedProps?.route;
      return r && typeof r === 'object' ? Reflect.get(r, 'name') : undefined;
    };
    // The innermost function component rendered with this route is the screen; its first child is its root View.
    while (fiber && !(typeof fiber.type === 'function' && routeName(fiber) === route && fiber.memoizedProps?.navigation)) fiber = fiber.return;
    const props = fiber?.child?.memoizedProps;
    if (!props) throw Error(`no root view for screen ${route}`);
    const style: Record<string, unknown> = {};
    const flatten = (s: unknown) => {
      if (Array.isArray(s)) s.forEach(flatten);
      else if (s && typeof s === 'object') Object.assign(style, s);
    };
    flatten(props.style);
    const ctx = document.createElement('canvas').getContext('2d');
    const present = (value: unknown) => value !== undefined && value !== null;
    // isColorMeaningful: any colour with a non-zero alpha.
    const meaningful = (color: unknown) => {
      if (!present(color) || !ctx) return false;
      ctx.fillStyle = '#000';
      ctx.fillStyle = String(color);
      return !/^rgba\(.*,\s*0\)$/.test(ctx.fillStyle);
    };
    const reasons: string[] = [];
    const when = (hit: boolean, why: string) => { if (hit) reasons.push(why); };
    const pointerEvents = props.pointerEvents ?? style.pointerEvents;
    const transform = style.transform;
    // formsStackingContext
    when(props.collapsable === false, 'collapsable=false');
    when(pointerEvents === 'box-only' || pointerEvents === 'none', `pointerEvents=${String(pointerEvents)}`);
    when(present(props.nativeID), 'nativeID');
    when(props.accessible === true, 'accessible');
    when(present(style.opacity) && Number(style.opacity) !== 1, `opacity=${String(style.opacity)}`);
    when(Array.isArray(transform) ? transform.length > 0 : typeof transform === 'string' && transform !== '', 'transform');
    when(present(style.zIndex) && style.position !== 'static', 'zIndex');
    when(style.display === 'none', 'display=none');
    when(present(style.overflow) && style.overflow !== 'visible', `overflow=${String(style.overflow)}`);
    for (const key of Object.keys(props)) when(typeof props[key] === 'function' && /^on(Layout|Pointer|Click|Touch|Responder|StartShouldSetResponder|MoveShouldSetResponder)/.test(key), key);
    when(meaningful(style.shadowColor), 'shadowColor');
    when(props.accessibilityElementsHidden === true, 'accessibilityElementsHidden');
    when(props.accessibilityViewIsModal === true || props['aria-modal'] === true, 'accessibilityViewIsModal');
    when(present(props.importantForAccessibility) && props.importantForAccessibility !== 'auto', 'importantForAccessibility');
    when(props.removeClippedSubviews === true, 'removeClippedSubviews');
    when(present(style.cursor) && style.cursor !== 'auto', 'cursor');
    when(present(style.filter), 'filter');
    when(present(style.mixBlendMode) && style.mixBlendMode !== 'normal', 'mixBlendMode');
    when(style.isolation === 'isolate', 'isolation');
    when(present(style.elevation) && Number(style.elevation) !== 0, 'elevation');
    when(present(props.accessibilityOrder), 'accessibilityOrder');
    // formsView
    when(meaningful(style.backgroundColor), `backgroundColor=${String(style.backgroundColor)}`);
    for (const key of ['borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStartWidth', 'borderEndWidth']) when(present(style[key]), key);
    when(present(props.testID), 'testID');
    when(present(style.boxShadow), 'boxShadow');
    when(present(style.experimental_backgroundImage), 'backgroundImage');
    when(present(style.outlineWidth) && Number(style.outlineWidth) > 0, 'outlineWidth');
    for (const key of ['nativeBackgroundAndroid', 'nativeForegroundAndroid']) when(present(props[key]), key);
    for (const key of ['focusable', 'hasTVPreferredFocus', 'needsOffscreenAlphaCompositing', 'renderToHardwareTextureAndroid', 'screenReaderFocusable']) when(props[key] === true, key);
    return { route, formsView: reasons.length > 0, reasons };
  }, route);
}
