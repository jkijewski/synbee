# 0013. Related items and delete warnings from one dependency index

## Decision

- **One dependency index,** rebuilt from the database for each request, records every use: actions and automations using devices, light groups and actions, and light groups holding devices.
- **Indirect links** are derived from it, through a light group's members or the actions an automation runs, and labelled "via light group X" or "via action Y". For automations, each link has a role: trigger, condition or target.
- **Related lists** on device, action and automation pages show these links both ways, with drafts and disabled automations marked.
- **Delete warnings** for devices, light groups and actions list what uses them directly, before anything is deleted.
- **Linked names:** every listed device, action, automation, light group and room links to its page, which opens by address (`#devices/<ieee>`, `#actions/<id>`, `#rules/<id>`, `#groups/<id>`, `#rooms/<id>`).
- **Forgetting a device** asks a joined device to leave the network (so it looks for a network again), or removes only the entry of one that never joined. Actions and automations that used it are kept and flagged.
