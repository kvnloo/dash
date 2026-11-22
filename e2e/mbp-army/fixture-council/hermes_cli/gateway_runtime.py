from types import SimpleNamespace


def discover_gateway_endpoint(home):
    return SimpleNamespace(endpoint=home)


def attachable(found):
    return True
