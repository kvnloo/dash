import type { Locator } from 'playwright/test';

/**
 * Native (Yoga) re-layout of a rendered subtree.
 *
 * The army drives the web build, where Chromium lays out flexbox. The phone lays out the same
 * React Native styles with Yoga, and the two disagree where CSS sizes a row from its content but
 * Yoga honours flex-basis: RN `flex: 1` is basis 0 on native, so a content-sized row collapses
 * there while the web build looks fine (DA-046: Chats filter chips were empty outlines on the S25).
 *
 * `nativeLayout` reads the computed (authored, not used) box styles of a subtree from the page,
 * rebuilds it in yoga-layout with React Native's defaults and lays it out under max-content width,
 * as a child of a horizontal ScrollView is. Leaves (text, icon glyphs) keep their measured web size.
 */

export type NativeBox = { testId: string | null; text: string; leaf: boolean; web: number; native: number; children: NativeBox[] };

type Snap = {
  testId: string | null; text: string; style: Record<string, string>; web: { w: number; h: number };
  natural?: { w: number; h: number }; children: Snap[];
};

const PROPS = ['display', 'position', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-wrap', 'align-items', 'align-self', 'justify-content',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'column-gap', 'row-gap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];

function snapshot(root: Locator): Promise<Snap> {
  return root.evaluate((element, props) => {
    const walk = (node: Element): Snap => {
      // Typed OM keeps `auto` widths as `auto`; getComputedStyle would report the used px size.
      const map = node.computedStyleMap();
      const style: Record<string, string> = {};
      for (const prop of props) style[prop] = map.get(prop)?.toString() ?? '';
      const rect = node.getBoundingClientRect();
      const kids = [...node.children].filter(kid => getComputedStyle(kid).display !== 'none');
      const snap: Snap = { testId: node.getAttribute('data-testid'), text: (node.textContent ?? '').trim(), style, web: { w: rect.width, h: rect.height }, children: [] };
      if (kids.length === 0) {
        // A text leaf's natural single-line size, even when numberOfLines has clipped it.
        const range = document.createRange(); range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        const pad = (side: string) => Number.parseFloat(style[`padding-${side}`] ?? '0') + Number.parseFloat(style[`border-${side}-width`] ?? '0');
        snap.natural = node.textContent ? { w: Math.ceil(text.width), h: rect.height - pad('top') - pad('bottom') } : { w: rect.width - pad('left') - pad('right'), h: rect.height - pad('top') - pad('bottom') };
      } else snap.children = kids.map(walk);
      return snap;
    };
    return walk(element);
  }, PROPS);
}

/** Lays `root` out with Yoga as React Native would on a phone, inside a max-content row. */
export async function nativeLayout(root: Locator): Promise<NativeBox> {
  const snap = await snapshot(root);
  const { loadYoga, Align, Direction, Edge, FlexDirection, Gutter, Justify, MeasureMode, PositionType, Wrap } = await import('yoga-layout/load');
  const Y = await loadYoga();
  const px = (value: string | undefined): number | undefined => {
    const m = /^(-?[\d.]+)px$/.exec(value ?? '');
    return m ? Number(m[1]) : value === '0' ? 0 : undefined;
  };
  const ALIGN: Record<string, number> = { 'flex-start': Align.FlexStart, start: Align.FlexStart, center: Align.Center, 'flex-end': Align.FlexEnd, end: Align.FlexEnd,
    baseline: Align.Baseline, stretch: Align.Stretch, normal: Align.Stretch };
  const JUSTIFY: Record<string, number> = { 'flex-start': Justify.FlexStart, start: Justify.FlexStart, normal: Justify.FlexStart, center: Justify.Center, 'flex-end': Justify.FlexEnd,
    end: Justify.FlexEnd, 'space-between': Justify.SpaceBetween, 'space-around': Justify.SpaceAround, 'space-evenly': Justify.SpaceEvenly };
  const align = (value: string | undefined) => ALIGN[value ?? ''];
  const justify = (value: string | undefined) => JUSTIFY[value ?? ''];
  const pairs: { snap: Snap; node: ReturnType<typeof Y.Node.create> }[] = [];
  const build = (s: Snap) => {
    const node = Y.Node.create(); const st = s.style; pairs.push({ snap: s, node });
    const dir = st['flex-direction'];
    node.setFlexDirection(dir === 'row' ? FlexDirection.Row : dir === 'row-reverse' ? FlexDirection.RowReverse : dir === 'column-reverse' ? FlexDirection.ColumnReverse : FlexDirection.Column);
    if (st['flex-wrap'] === 'wrap') node.setFlexWrap(Wrap.Wrap);
    if (st.position === 'absolute') node.setPositionType(PositionType.Absolute);
    node.setFlexGrow(Number(st['flex-grow']) || 0);
    node.setFlexShrink(Number(st['flex-shrink']) || 0);
    // RN-web writes RN `flex: N` as `N 1 0%`; on native that basis is 0 points, not a percentage.
    const basis = st['flex-basis'];
    if (basis === '0%' || basis === '0' || basis === '0px') node.setFlexBasis(0);
    else if (px(basis) !== undefined) node.setFlexBasis(px(basis));
    const a = align(st['align-items']); if (a !== undefined) node.setAlignItems(a);
    const self = st['align-self']; if (self && self !== 'auto') { const v = align(self); if (v !== undefined) node.setAlignSelf(v); }
    const j = justify(st['justify-content']); if (j !== undefined) node.setJustifyContent(j);
    const size = (value: string | undefined, points: (n: number) => void, percent: (n: number) => void) => {
      const n = px(value); if (n !== undefined) return points(n);
      const m = /^([\d.]+)%$/.exec(value ?? ''); if (m) percent(Number(m[1]));
    };
    size(st.width, n => node.setWidth(n), n => node.setWidthPercent(n));
    size(st.height, n => node.setHeight(n), n => node.setHeightPercent(n));
    size(st['min-width'], n => node.setMinWidth(n), n => node.setMinWidthPercent(n));
    size(st['max-width'], n => node.setMaxWidth(n), n => node.setMaxWidthPercent(n));
    size(st['min-height'], n => node.setMinHeight(n), n => node.setMinHeightPercent(n));
    size(st['max-height'], n => node.setMaxHeight(n), n => node.setMaxHeightPercent(n));
    const gapC = px(st['column-gap']); if (gapC) node.setGap(Gutter.Column, gapC);
    const gapR = px(st['row-gap']); if (gapR) node.setGap(Gutter.Row, gapR);
    const edges: [string, number][] = [['top', Edge.Top], ['right', Edge.Right], ['bottom', Edge.Bottom], ['left', Edge.Left]];
    for (const [side, edge] of edges) {
      node.setPadding(edge, px(st[`padding-${side}`]) ?? 0);
      node.setBorder(edge, px(st[`border-${side}-width`]) ?? 0);
      node.setMargin(edge, px(st[`margin-${side}`]) ?? 0);
    }
    if (s.natural) {
      const natural = s.natural;
      node.setMeasureFunc((width, widthMode) => ({
        width: widthMode === MeasureMode.Undefined ? natural.w : widthMode === MeasureMode.Exactly ? width : Math.min(natural.w, width),
        height: natural.h,
      }));
    } else s.children.forEach((kid, index) => node.insertChild(build(kid), index));
    return node;
  };
  // A horizontal ScrollView's content container: a row with no width bound.
  const host = Y.Node.create(); host.setFlexDirection(FlexDirection.Row); host.setAlignItems(Align.FlexStart);
  host.insertChild(build(snap), 0);
  host.calculateLayout(undefined, undefined, Direction.LTR);
  const width = new Map(pairs.map(({ snap: s, node }) => [s, node.getComputedWidth()]));
  const out = (s: Snap): NativeBox => ({ testId: s.testId, text: s.text, leaf: !!s.natural, web: s.web.w, native: width.get(s) ?? 0, children: s.children.map(out) });
  const result = out(snap);
  host.freeRecursive();
  return result;
}

/** Text leaves of a re-laid-out subtree, in order. */
export function nativeLeaves(box: NativeBox): NativeBox[] {
  return box.leaf ? (box.text ? [box] : []) : box.children.flatMap(nativeLeaves);
}
