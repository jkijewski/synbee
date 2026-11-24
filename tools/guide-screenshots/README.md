# User guide screenshots

`make.sh` starts the hub with its Zigbee simulator and a throwaway data folder, fills it with a sample home through the hub's own API (`populate.mjs`), takes the screenshots in headless Chrome (`shots.mjs`, over the DevTools protocol in `cdp.mjs`), and writes them, scaled to 1600 px, to `docs/images/guide/`. Addresses of the machine running it are replaced with sample ones in the pictures. Nothing touches a real NAS or gateway.

Run it after changing a page the [user guide](../../docs/user-guide.md) shows.
