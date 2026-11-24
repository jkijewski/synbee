# 0020. App members, paired by QR code

## Context

The mobile app is for the people who live in the home. It must be simple to set up for a family, must not depend on outside accounts, and must not be able to change how the home is configured.

## Decision

- **Members are SynBee's own,** not DSM users. A member is a name with permissions and paired phones, stored in the hub's database. Nobody needs a DSM account to use the app, and removing a member removes their phones in the same place.
- **No passwords in the app.** A phone proves who it is with a token it receives once, when it is paired. The hub keeps only the token's SHA-256 hash.
- **Pairing by QR code, at home or away.** The owner chooses "Pair a phone" for a member. The QR code (and a short code to type) holds the hub's home addresses, its outside address when the app may be used away from home, the fingerprint of its key, and a one-time code valid for 10 minutes. Pairing is accepted from anywhere: the one-time code (50 bits, used once, attempts limited per address) is the protection.
- **Away from home per phone.** Each phone has its own "Away from home" switch: off for a phone paired at home, on for one paired away from home, since it is evidently meant to be used there.
- **Permissions are revocations.** A member may use every action and room, including new ones, until the owner revokes one. Devices follow their main room.
- **No admin in the app.** Members, permissions and phones are managed only in the web interface, behind the owner's sign-in.

## Alternatives considered

- **Google sign-in.** Needs an OAuth project per installation and an allowlist of accounts, and ties the home to an outside account.
- **DSM users.** Every family member would need a DSM account, which can open shared folders; packages can't easily read or check DSM users without root; and phones wouldn't be revoked when a DSM user is deleted.
- **A password per member.** Something to remember and reset, while the phone itself is what should be trusted.

## Consequences

- A new or reinstalled phone is paired again, which takes seconds.
- A stolen phone keeps working until the owner revokes it.
