#!/usr/bin/env python3
"""Assert native integration from the merged manifest, not app.json."""
import json
import os
import sys
import xml.etree.ElementTree as ET


manifest = ET.parse(sys.argv[1]).getroot()
android = "{http://schemas.android.com/apk/res/android}"
assert manifest.attrib["package"] == "app.dash.mobile"
permissions = {node.attrib.get(android + "name") for node in manifest.findall("uses-permission")}
assert "android.permission.POST_NOTIFICATIONS" in permissions
activities = manifest.findall("application/activity")
main = next(node for node in activities if node.attrib[android + "name"].endswith("MainActivity"))
assert main.attrib[android + "exported"] == "true"
assert main.attrib[android + "launchMode"] == "singleTask"
filters = main.findall("intent-filter")
for action in ["android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"]:
    matching = [node for node in filters if any(a.attrib.get(android + "name") == action for a in node.findall("action"))]
    assert any(any(data.attrib.get(android + "mimeType") == "*/*" for data in node.findall("data")) for node in matching), action
schemes = {data.attrib.get(android + "scheme") for node in filters for data in node.findall("data")}
release = os.environ.get("DASH_VARIANT") == "release"
# exp+dash is the dev-client launcher scheme; the RC has no dev client.
assert ({"dash"} if release else {"dash", "exp+dash"}) <= schemes, schemes
application = manifest.find("application")
assert application is not None
if release:
    assert application.attrib.get(android + "debuggable") != "true"
    # ws:// to the tailnet bridge: release builds block cleartext unless the manifest allows it.
    assert application.attrib.get(android + "usesCleartextTraffic") == "true"
else:
    assert application.attrib.get(android + "debuggable") == "true"
result = {"package": "app.dash.mobile", "variant": "release" if release else "debug", "debuggable": not release, "cleartext": application.attrib.get(android + "usesCleartextTraffic"), "share_actions": ["SEND", "SEND_MULTIPLE"], "mime": "*/*", "schemes": sorted(s for s in schemes if s), "post_notifications_permission": True}
print(json.dumps(result, indent=2))
