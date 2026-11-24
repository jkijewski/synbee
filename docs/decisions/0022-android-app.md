# 0022. The Android app is a separate project

## Decision

- The app lives in its own repository, `synbee-android`, with its own versions and releases. It depends on the hub only through the app API ([0021](0021-app-api.md)).
- **Kotlin and Jetpack Compose,** minSdk 29, targetSdk the current one (compiled against the newest platform the libraries need).
- **What it does:** pairs by QR code or typed code, at home or away; shows the member's rooms as tabs to swipe between, each with its actions as tiles coloured by what they switch; runs an action with a tap; shows what an action touches and a room's devices on a long press; and offers a demo with a sample home. It changes no configuration. Its own design is documented in its repository.
- The app trusts exactly the paired key, and keeps its token encrypted with an Android Keystore key.
- It is published on Google Play, signed with one release key kept outside both repositories.

## Consequences

- The hub and the app can be released apart. The app checks the API version in `ping` and says when the hub is too old.
