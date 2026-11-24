# gateway Specification

## Purpose

One place in the hub for the Zigbee coordinator ("the gateway"): its state, network map, settings, backup and replacement.

How this is built and why: [0007](../../../docs/decisions/0007-gateway-backup-and-replacement.md), [0009](../../../docs/decisions/0009-device-commands.md).

## Requirements

### Requirement: Gateway status
The hub SHALL have a Gateway page, on the internal listener behind sign-in, showing whether the gateway is connected, its address, adapter type, firmware, IEEE address, the bundled and running Zigbee2MQTT versions, the channel, PAN ID and extended PAN ID, the number of devices and the time of the last backup. It SHALL NOT show the network key.

#### Scenario: Opening the page
- **WHEN** the owner opens the Gateway page while an SLZB-06M is connected
- **THEN** it shows "connected", tcp://192.168.1.50:6638, the ember adapter with EmberZNet firmware and channel 25, and no network key

### Requirement: Gateway connection shown everywhere
Every page of the web interface SHALL show whether the gateway is connected, from Zigbee2MQTT's bridge state, as a light in the header that links to the Gateway page. While it isn't connected, the attention list SHALL show it first, as an alarm. When it has been gone for 2 minutes the hub SHALL send an alarm notification, and when it comes back an info notification; a shorter loss, such as a Zigbee2MQTT restart, SHALL NOT notify.

#### Scenario: Gateway unplugged
- **WHEN** the owner unplugs the gateway for 5 minutes
- **THEN** the header light turns red and the Devices page lists "Zigbee gateway: Not connected" first
- **AND** after 2 minutes the bell shows the alarm "Zigbee gateway not connected", and when it's plugged in again, "Zigbee gateway connected again"

#### Scenario: Zigbee2MQTT restart
- **WHEN** the owner restarts the Zigbee connection
- **THEN** the light is red for a few seconds, and no notification is sent

### Requirement: Backup matches its coordinator
The Gateway page SHALL say whether the coordinator in use carries the network's original IEEE address from the backup, matching the address in either byte order.

#### Scenario: Ember backup
- **GIVEN** a backup that stores 0x1122334455667788 for the coordinator 0x8877665544332211
- **THEN** the page reports the same coordinator

### Requirement: Gateway actions
The Gateway page SHALL offer adding devices, restarting the Zigbee connection, backup download and restore, and a link to the gateway's own web page for firmware updates. SynBee SHALL NOT update the gateway's firmware itself.

#### Scenario: Restart
- **WHEN** the owner restarts the Zigbee connection
- **THEN** Zigbee2MQTT is restarted with the current settings, and the hub keeps running

### Requirement: Network map
On request, the Gateway page SHALL draw the network from Zigbee2MQTT's network scan, with each device's link quality, and warn that the scan takes a while.

#### Scenario: Drawing the map
- **WHEN** the owner asks for the map
- **THEN** the gateway, routers and end devices are shown with their links and link quality, and each device name links to its page

### Requirement: Gateway settings
The owner SHALL be able to set the adapter type and hardware flow control. The Zigbee channel SHALL be under "Advanced" and SHALL change only after the owner confirms that devices may need pairing again. Saved settings SHALL apply when Zigbee2MQTT restarts.

#### Scenario: Channel change without confirmation
- **WHEN** the owner changes the channel without confirming
- **THEN** the hub refuses and keeps the current channel

### Requirement: Replace the gateway
The Gateway page SHALL guide the replacement of a failed gateway: a backup, disconnecting the old one, the new address typed in or found on the network, confirmation, and the result. Finding SHALL use mDNS announcements only and SHALL NOT connect to a coordinator. The page SHALL state that a network has exactly one gateway.

#### Scenario: Finding the new gateway
- **WHEN** an SLZB-06M announces itself on the network and the owner presses "Find on network"
- **THEN** it is listed with its address, and choosing it fills in the address

### Requirement: The gateway's own protection
The hub SHALL check, when it starts, every 30 minutes, when the gateway comes back and when the owner asks, whether the gateway's own web page (port 80 of its address) opens without a login, by anonymous read-only requests (its front page, and for an SMLIGHT gateway the data request its page makes, which a login guards even though the page shell itself always opens); it MUST NOT log in or change anything. While the page opens without a login, the Gateway page and the attention list SHALL warn, and the hub SHALL send one warning notification each time it becomes open, saying how to turn on the gateway's login and its socket whitelist. A page that doesn't answer (switched off, or none) SHALL NOT be warned about. The alarm for a lost gateway SHALL also say that, if nobody restarted or unplugged it, another device may have taken its connection.

#### Scenario: SLZB page without a login
- **GIVEN** an SLZB-06M whose web authentication is off
- **WHEN** the hub checks its page
- **THEN** the Gateway page shows "Its web page: no password" with how to fix it, the attention list shows a warning, and the bell has one warning

#### Scenario: Login turned on
- **WHEN** the owner turns on the SLZB's web authentication and presses "Check again"
- **THEN** the Gateway page shows "asks for a login" and the warning leaves the attention list

### Requirement: Several gateways
The hub SHALL support up to 9 gateways, each its own Zigbee network with its own coordinator, channel, Zigbee2MQTT and backup. The owner SHALL be able to add, rename and remove gateways on the Gateway page (the first can be replaced, not removed), set a new gateway's address, and see and manage each one separately. A new gateway SHALL default to channel 20. "Add devices" SHALL let the owner choose where devices join: a whole gateway (the first by default) or one mains-powered device (a router) of any gateway, in which case only that device lets new devices in, so they join its gateway with a strong link. Only one network SHALL be open at a time. Battery devices SHALL NOT be offered, as they can't let others in. Rules, actions, rooms, light groups, history and the app SHALL work across all gateways; a light group with lights on several gateways SHALL be switched on each. Alarms about a lost gateway SHALL name it, and the header light SHALL be green only while every gateway is connected.

#### Scenario: A second gateway in the garage
- **WHEN** the owner adds the gateway "Garaż", enters its address and pairs the garage light through it
- **THEN** the light appears with the other devices, a rule can switch it with a bedroom remote on the first gateway, and the Gateway page shows "Garaż" with its own channel, status and backup

#### Scenario: One gateway lost
- **WHEN** "Garaż" is unplugged for 5 minutes
- **THEN** the header light turns red with "Not connected: Garaż", the bell shows "Zigbee gateway "Garaż" not connected", and devices on the first gateway keep working

#### Scenario: Pairing a sensor in the garage
- **WHEN** the owner chooses "Join through: garage light" (a bulb on gateway "Garaż") and starts waiting
- **THEN** only the garage light accepts new devices, and the sensor that joins is on gateway "Garaż"

### Requirement: Harden gateway security
The Gateway page SHALL offer, per gateway, a "Harden gateway security" checklist of the gateway's own protections, each with where to set it: a web login (checked by the hub itself), the socket's IP whitelist for the NAS, a password for its recovery Wi-Fi and its own MQTT and Home Assistant features off (required), and Wi-Fi off and the web page off while SynBee is connected (optional). For an SMLIGHT SLZB, the owner MAY give SynBee the gateway's web login, which the hub SHALL check against the gateway before keeping it in the package's private folder. With it, the hub SHALL read the protections from the gateway and set each one only when the owner asks (socket whitelist with the address the gateway sees the NAS connect from, recovery Wi-Fi password, its own MQTT off, web page off while connected), sending every other setting back unchanged and reading the result back. Firmware the hub hasn't been tested with SHALL need the owner's confirmation. If the radio can't be reached two minutes after the whitelist is set, the hub SHALL switch the whitelist off again and notify the owner. Without the login, the steps SHALL be a checklist the owner ticks; the page SHALL show how many required steps are left either way.

#### Scenario: Setting the whitelist from SynBee
- **GIVEN** the gateway's login is kept in SynBee
- **WHEN** the owner presses "Allow only this NAS"
- **THEN** the gateway's socket accepts only the NAS's address, its web login and other settings are unchanged, and the card shows "on, allowed 192.168.1.20"

#### Scenario: A wrong whitelist
- **WHEN** SynBee can't reach the radio two minutes after the whitelist was set
- **THEN** it switches the whitelist off again and the bell says so

