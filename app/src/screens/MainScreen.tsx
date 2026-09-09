import { useCallback, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import PagerView from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionPill } from "../components/ConnectionPill";
import { Header, IconButton } from "../components/Header";
import { TopTabs } from "../components/TopTabs";
import type { ScreenProps } from "../navigation";
import { colors } from "../theme";
import { BotsPane } from "./panes/BotsPane";
import { ChatsPane } from "./panes/ChatsPane";
import { OrchestraPane } from "./panes/OrchestraPane";

export function MainScreen({ navigation }: ScreenProps<"Main">) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<PagerView>(null);
  const [index, setIndex] = useState(1);

  const onTab = useCallback((next: number) => {
    setIndex(next);
    pagerRef.current?.setPage(next);
  }, []);

  const onPage = useCallback((e: { nativeEvent: { position: number } }) => {
    setIndex(e.nativeEvent.position);
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        left={<View style={styles.sideSpacer} />}
        center={<TopTabs index={index} onChange={onTab} />}
        right={
          <IconButton icon="options-outline" label="Settings" onPress={() => navigation.navigate("Settings")} />
        }
      />
      <ConnectionPill />
      <PagerView ref={pagerRef} style={styles.pager} initialPage={1} onPageSelected={onPage} overdrag>
        <View key="bots" style={{ width }}>
          <BotsPane navigation={navigation} />
        </View>
        <View key="chats" style={{ width }}>
          <ChatsPane navigation={navigation} />
        </View>
        <View key="orchestra" style={{ width }}>
          <OrchestraPane navigation={navigation} />
        </View>
      </PagerView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  sideSpacer: { width: 40 },
  pager: { flex: 1 },
});
