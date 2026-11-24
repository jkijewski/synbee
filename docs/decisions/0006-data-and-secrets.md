# 0006. Data in a shared folder, secrets in the package's private folder

## Context

The owner should be able to back up SynBee's data with DSM's tools, but keys must not be readable by anyone with access to a shared folder.

## Decision

- **Data without secrets** lives in a `synbee` folder inside a shared folder chosen in the install wizard (created by DSM's data-share worker): the hub database (devices, rooms, actions, rules, history) and room photos.
- **Secrets live in the package's private folder,** outside every share: the MQTT password and other generated secrets.
- **Zigbee2MQTT's whole data folder is private too.** It holds the network key in its configuration and in `coordinator_backup.json`. Moving the whole folder keeps every copy of the key out of the share with one setting, without changing how Zigbee2MQTT works.
- Files that may hold keys are written with owner-only permissions. Moving them copies, checks and deletes, because a rename doesn't work across btrfs subvolumes.
- Log lines that could hold a key or password are hidden when the web interface shows logs.
- **Upgrades keep a way back.** Before migrating a database that has data, the hub copies it next to itself (`hub.db.before-v<version>-<time>`, with SQLite's `VACUUM INTO`) and logs each migration in the database. Before every package upgrade, the package copies each gateway's Zigbee2MQTT data folder into `snapshots/` in the private folder. The last 3 copies of each are kept. Migrations run in order, each in one transaction. The Status page shows the database version, the recent upgrades, the copies and how to go back.

## Consequences

- A backup of the shared folder holds no keys. The Zigbee network is backed up separately ([0007](0007-gateway-backup-and-replacement.md)).
- Going back to an older version means stopping SynBee, putting a copy back as `hub.db`, and installing the older package after uninstalling with data kept.
