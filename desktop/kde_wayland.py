"""Connect Electron to the KDE shortcut portal and KWin window positioning."""

from contextlib import suppress
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

try:
    from gi.repository import Gio, GLib
except ImportError:
    print("KDE Wayland 需要系统 Python 的 PyGObject（gi）", file=sys.stderr)
    sys.exit(1)


PORTAL = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
SHORTCUTS = "org.freedesktop.portal.GlobalShortcuts"


def emit(**event):
    print(json.dumps(event, ensure_ascii=True), flush=True)


def call(bus, destination, path, interface, method, arguments=None):
    return bus.call_sync(
        destination, path, interface, method, arguments,
        None, Gio.DBusCallFlags.NONE, 5000,
    )


def bind_shortcuts(bus):
    config = json.loads(sys.stdin.readline())
    loop = GLib.MainLoop()
    sender = bus.get_unique_name()[1:].replace(".", "_")
    session = None

    def request(method, token, signature, args, on_success):
        expected = f"{PATH}/request/{sender}/{token}"

        def response(_bus, _sender, _path, _interface, _signal, parameters):
            bus.signal_unsubscribe(subscription)
            code, result = parameters.unpack()
            if code != 0:
                emit(error=f"{method}: Portal response {code}")
                loop.quit()
                return
            try:
                on_success(result)
            except (GLib.Error, KeyError) as error:
                print(str(error), file=sys.stderr)
                loop.quit()

        subscription = bus.signal_subscribe(
            PORTAL, "org.freedesktop.portal.Request", "Response", expected, None,
            Gio.DBusSignalFlags.NONE, response,
        )
        call(bus, PORTAL, PATH, SHORTCUTS, method, GLib.Variant(signature, args))

    def activated(_bus, _sender, _path, _interface, _signal, parameters):
        handle, shortcut, *_ = parameters.unpack()
        if handle == session:
            emit(activated=shortcut)

    def publish_bindings(shortcuts):
        emit(bound=[
            shortcut for shortcut, properties in shortcuts
            if properties.get("trigger_description")
        ])

    def shortcuts_changed(_bus, _sender, _path, _interface, _signal, parameters):
        handle, shortcuts = parameters.unpack()
        if handle == session:
            publish_bindings(shortcuts)

    def created(result):
        nonlocal session
        session = result["session_handle"]
        token = "bind_" + uuid4().hex
        shortcuts = [
            (entry["id"], {
                "description": GLib.Variant("s", entry["label"]),
                "preferred_trigger": GLib.Variant("s", entry["trigger"]),
            })
            for entry in config["shortcuts"]
        ]
        request("BindShortcuts", token, "(oa(sa{sv})sa{sv})", (
            session, shortcuts, "", {"handle_token": GLib.Variant("s", token)},
        ), lambda result: publish_bindings(result.get("shortcuts", [])))

    call(bus, PORTAL, PATH, "org.freedesktop.host.portal.Registry", "Register",
         GLib.Variant("(sa{sv})", (config["appId"], {})))
    bus.signal_subscribe(PORTAL, SHORTCUTS, "Activated", PATH, None, Gio.DBusSignalFlags.NONE, activated)
    bus.signal_subscribe(
        PORTAL, SHORTCUTS, "ShortcutsChanged", PATH, None, Gio.DBusSignalFlags.NONE, shortcuts_changed,
    )
    token = "create_" + uuid4().hex
    request("CreateSession", token, "(a{sv})", ({
        "handle_token": GLib.Variant("s", token),
        "session_handle_token": GLib.Variant("s", "shortcuts_" + uuid4().hex),
    },), created)
    GLib.io_add_watch(sys.stdin, GLib.PRIORITY_DEFAULT, GLib.IO_HUP, lambda *_: loop.quit() or False)
    loop.run()


def move_overlay(bus, pid, title):
    # Electron cannot set absolute window positions under Wayland. Move only the
    # caller's overlay through the compositor, then unload the one-shot script.
    source = f"""
        const overlay = workspace.windowList().find(window =>
          window.pid === {int(pid)} && (window.captionNormal || window.caption) === {json.dumps(title)}
        );
        if (!overlay) throw new Error('Overlay window missing');
        const cursor = workspace.cursorPos;
        const {{ width, height }} = overlay.frameGeometry;
        overlay.frameGeometry = {{
          x: Math.round(cursor.x - 20), y: Math.round(cursor.y - 20), width, height
        }};
    """
    kwin = "org.kde.KWin"
    scripting = "org.kde.kwin.Scripting"
    with TemporaryDirectory(prefix="ia-kwin-overlay-") as directory:
        script = Path(directory) / "move.js"
        script.write_text(source, encoding="utf-8")
        name = script.parent.name
        script_id, = call(bus, kwin, "/Scripting", scripting, "loadScript",
                          GLib.Variant("(ss)", (str(script), name))).unpack()
        if script_id < 0:
            raise RuntimeError("KWin 无法加载悬浮窗定位脚本")
        try:
            call(bus, kwin, f"/Scripting/Script{script_id}", "org.kde.kwin.Script", "run")
        finally:
            with suppress(GLib.Error):
                call(bus, kwin, "/Scripting", scripting, "unloadScript", GLib.Variant("(s)", (name,)))


if __name__ == "__main__":
    try:
        bus = Gio.bus_get_sync(Gio.BusType.SESSION)
        if sys.argv[1] == "bind-shortcuts":
            bind_shortcuts(bus)
        else:
            move_overlay(bus, *sys.argv[2:])
    except (GLib.Error, KeyError, ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
