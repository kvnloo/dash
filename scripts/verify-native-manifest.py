#!/usr/bin/env python3
"""Assert native integration from the merged manifest, not app.json."""
import json
import os
import sys
import xml.etree.ElementTree as ET


manifest = ET.parse(sys.argv[1]).getroot()
android = "{http://schemas.android.com/apk/res/android}"
e2e = os.environ.get("DASH_APP_VARIANT") == "e2e"
package = "app.dash.mobile.e2e" if e2e else "app.dash.mobile"
scheme = "dash-e2e" if e2e else "dash"
assert manifest.attrib["package"] == package, manifest.attrib["package"]
permissions = {node.attrib.get(android + "name") for node in manifest.findall("uses-permission")}
assert "android.permission.POST_NOTIFICATIONS" in permissions
for permission in ("android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"):
    assert permission in permissions, permission
activities = manifest.findall("application/activity")
main = next(node for node in activities if node.attrib[android + "name"].endswith("MainActivity"))
assert main.attrib[android + "exported"] == "true"
assert main.attrib[android + "launchMode"] == "singleTask"
# DeX changes must survive Expo prebuild and manifest merging.
required_changes = {"smallestScreenSize", "screenLayout", "density", "uiMode", "orientation"}
assert main.attrib.get(android + "resizeableActivity") == "true"
assert required_changes <= set(main.attrib.get(android + "configChanges", "").split("|"))
pad = next(node for node in activities if node.attrib[android + "name"] == "app.dash.dex.DashPadActivity")
assert pad.attrib.get(android + "exported") == "false"
assert pad.attrib.get(android + "resizeableActivity") == "true"
assert pad.attrib.get(android + "launchMode") == "singleTask"
assert required_changes <= set(pad.attrib.get(android + "configChanges", "").split("|"))
metadata = {node.attrib.get(android + "name"): node.attrib.get(android + "value") for node in manifest.findall("application/meta-data")}
assert metadata.get("com.samsung.android.multidisplay.keep_process_alive") == "true"
assert all(node.attrib.get(android + "reqTouchScreen") != "finger" for node in manifest.iter())
assert all(node.attrib.get(android + "required") == "false" for node in manifest.findall("uses-feature") if node.attrib.get(android + "name") == "android.hardware.touchscreen")
filters = main.findall("intent-filter")
for action in ["android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"]:
    matching = [node for node in filters if any(a.attrib.get(android + "name") == action for a in node.findall("action"))]
    assert any(any(data.attrib.get(android + "mimeType") == "*/*" for data in node.findall("data")) for node in matching), action
schemes = {data.attrib.get(android + "scheme") for node in filters for data in node.findall("data")}
release = os.environ.get("DASH_VARIANT") == "release"
# exp+dash is the dev-client launcher scheme; the RC has no dev client.
assert ({scheme} if release else {scheme, "exp+" + scheme}) <= schemes, schemes
assert e2e or "dash-e2e" not in schemes, schemes
application = manifest.find("application")
assert application is not None
if release:
    assert application.attrib.get(android + "debuggable") != "true"
    # ws:// to the tailnet bridge: release builds block cleartext unless the manifest allows it.
    assert application.attrib.get(android + "usesCleartextTraffic") == "true"
else:
    assert application.attrib.get(android + "debuggable") == "true"
result = {"package": package, "variant": "release" if release else "debug", "debuggable": not release, "cleartext": application.attrib.get(android + "usesCleartextTraffic"), "share_actions": ["SEND", "SEND_MULTIPLE"], "mime": "*/*", "schemes": sorted(s for s in schemes if s), "post_notifications_permission": True, "record_audio_permission": True, "modify_audio_settings_permission": True}
print(json.dumps(result, indent=2))
