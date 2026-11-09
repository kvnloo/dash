import { renderToStaticMarkup } from "react-dom/server";
import { AppRegistry, View } from "react-native";
import { RippleRoadmap } from "./RippleRoadmap";
import { parseGenUI } from "../../lib/genui";
const widgets = parseGenUI(JSON.stringify({ version:1, components:[{type:"card",title:"Dash · preview delivery",children:[
{type:"progress",title:"Persistent attached session + compact chat peek",value:25,text:"Partial routing edits · not merged"},
{type:"progress",title:"Dictation and Telegram-style mic switch",value:75,text:"In preview · phone dictation still unconfirmed"},
{type:"progress",title:"Trace intent contract + validation + artifacts",value:0,text:"Planned · implementation blocked"}
]}]}));
if(!widgets)throw Error("fixture invalid");
AppRegistry.registerComponent("Preview",()=>()=> <View style={{padding:16,backgroundColor:"#000"}}><RippleRoadmap/></View>);
// @ts-expect-error React Native Web supplies getApplication in the capture-only harness.
const {element,getStyleElement}=AppRegistry.getApplication("Preview",{});
console.log('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+renderToStaticMarkup(getStyleElement())+'<style>body{margin:0;background:#000}</style>'+renderToStaticMarkup(element));
