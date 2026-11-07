import "./reanimated-gc";
import { registerRootComponent } from "expo";
import App from "../App";
import { AppRegistry } from "react-native";
import { DashPad } from "./components/dex/DashPad";
AppRegistry.registerComponent("DashPad", () => DashPad);
registerRootComponent(App);
