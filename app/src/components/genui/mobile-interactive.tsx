import {createRoot} from "react-dom/client";
import {RippleRoadmap} from "./RippleRoadmap";
const root = document.getElementById("root");
if(!root) throw new Error("Root missing");
createRoot(root).render(<RippleRoadmap/>);
