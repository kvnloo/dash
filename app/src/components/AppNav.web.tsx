import { forwardRef, useImperativeHandle } from "react";
import type { NavigationProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";
import { haptic } from "../haptics";
import { EXPAND_PATH, GOLDEN_NAV_CSS, TAB_LABELS, indicatorTransform } from "./golden-nav";

export type AppNavHandle = {
  setProgress(progress: number): void;
};

export const AppNav = forwardRef<
  AppNavHandle,
  {
    navigation: NavigationProp<RootStackParamList>;
    tab: number;
    onTab?(next: number): void;
    progress?: unknown;
  }
>(function AppNav({ navigation, tab, onTab }, ref) {
  useImperativeHandle(ref, () => ({ setProgress() {} }), []);

  const goTab = (next: number) => {
    haptic.tap();
    if (onTab) onTab(next);
    else navigation.navigate("Main", { tab: next });
  };

  return (
    <>
      <style>{`${GOLDEN_NAV_CSS}
.dash-appnav { height: 80px; }
.dev-mobile-pager-indicator { transition: transform 220ms cubic-bezier(.2,.75,.2,1); }
`}</style>
      <div className="dash-appnav">
        <button
          type="button"
          className="dev-mobile-immersive-toggle"
          aria-label="Expand"
          onClick={() => {
            haptic.tap();
            navigation.navigate("Voice");
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={EXPAND_PATH} />
          </svg>
        </button>
        <nav className="dev-mobile-pager" aria-label="Primary mobile workspace">
          <span
            className="dev-mobile-pager-indicator"
            aria-hidden="true"
            style={{ transform: indicatorTransform(tab) }}
          />
          {TAB_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-label={label}
              aria-selected={i === tab}
              className={i === tab ? "is-active" : undefined}
              onClick={() => goTab(i)}
            >
              <span className="dev-mobile-pager-dot" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="dev-mobile-pager-toggle"
          aria-label="Menu"
          onClick={() => {
            haptic.tap();
            navigation.navigate("Settings");
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
    </>
  );
});
