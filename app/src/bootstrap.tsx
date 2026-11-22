import "./reanimated-gc";
import "./performance-trim";
import { registerRootComponent } from "expo";
import App from "../App";
import { AppRegistry } from "react-native";
import { DashPad } from "./components/dex/DashPad";
AppRegistry.registerComponent("DashPad", () => DashPad);
registerRootComponent(App);
