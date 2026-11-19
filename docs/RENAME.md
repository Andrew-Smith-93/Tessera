# Upgrading from Tessera to Movement
Movement is the same Linux KWin script, not a second tiler. Update the existing installation in place; do not uninstall or purge it for the rename. With a new source archive, use `kpackagetool6 --type KWin/Script --upgrade movement-v<version>.kwinscript` (substitute the built version). Published pre-rename release assets retain their original filenames.

* KDE continues to identify the package by `tessera` (plugin ID and keyword). The installation directory, `tesseraEnabled` switch and `[Script-tessera]` group therefore resolve to the same script and configuration.
* KGlobalAccel action IDs beginning with `Tessera: ` are stable keys, not a second set of shortcuts. Changing them would orphan customized or intentionally unbound actions. Search by action, for example **Toggle Zone Overlay**, under Shortcuts → KWin.
* Legacy launcher, control-center and config filenames remain in cleanup code. Existing installer flags keep their original spelling. Protocol v1 identifiers, schema URLs, schema titles and frozen fixtures remain compatible with existing clients.
* The repository URL and KDE Store product ID 2375512 are unchanged. Existing release notes, live acceptance records and archived artifacts describe the versions actually tested under the old name. This source change does not publish a release or update either service.
