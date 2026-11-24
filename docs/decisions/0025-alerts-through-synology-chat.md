# 0025. Alerts leave the hub through Synology Chat

## Context

Notifications stayed in SynBee's own inbox, which nobody sees away from the browser. They had to reach the owner's phone, without a cloud service of SynBee's own and without root.

## Decision

- **DSM's own notifications are not available.** DSM's package resource for system notifications (`sysnotify`) is reserved for Synology's own packages: Package Center refuses a third-party package that declares it ("a resource for Synology packages only"), tested on DSM 7.2. Calling DSM's notification tools would need root, which SynBee doesn't have.
- **Synology Chat instead.** The owner pastes a Chat channel's incoming webhook address; SynBee posts each notification at or above the chosen level (alarms, warnings and alarms, or everything) to it, and the Synology Chat app shows it on the phone at once. Chat runs on the same NAS, so alerts stay on the owner's equipment until Chat pushes them.
- **The address is a secret:** it holds a token, so it is kept owner-only in the private folder (`synology-chat.json`) and shown without the token. Only Chat's incoming webhook addresses are accepted. The NAS's own self-signed certificate is accepted on home addresses.
- **The inbox stays the record:** every notification is kept there, whether or not it was sent.
- **Pausing:** the owner can allow single app users to pause what goes to Chat (an hour, eight hours, until 7:00) or resume; the Notifications page shows who paused and until when.

## Alternatives considered

- **Push through Google (FCM).** Instant to the SynBee app, but needs a Firebase project per installation and Google's servers.
- **Email from SynBee.** Works anywhere, but SynBee would keep a mail password, and email isn't instant.
- **Log Center keyword rules.** Uses DSM's channels, but needs Log Center, log receiving and keyword rules for each level.
- **Uptime Kuma's push monitors.** A detour: Kuma tracks up/down states, not messages.

## Consequences

- Alerts need the Synology Chat Server package and the Chat app; without them they stay in the inbox.
- Another channel (email, ntfy) can be added behind the same notification hook later.
