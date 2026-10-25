import { createStore } from "./createStore";
export const notificationState = createStore({ available: false, enabled: false, permission: "unavailable", error: "" });
