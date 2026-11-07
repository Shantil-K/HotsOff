# HotsOff development notes

## How the Hotstar webOS app works

The Hotstar IPK (`hotstar`, 2.3.4 / store 3.0.2) is only a launcher: its
`index.html` redirects to `https://livingroom.hotstar.com/?platform=webos`.
All app code is a remote Next.js bundle, so there is nothing local to patch and
AmazOff's nginx/TLS approach is not needed.

Instead HotsOff uses webOS WebAppManager user scripts: WAM injects
`<app dir>/webOSUserScripts/userScript.js` into every page of the app (the same
mechanism youtube-webos uses). `tools/patchctl.sh start` copies
`resources/hotstar/webOSUserScripts/userScript.js` into the installed Hotstar
folder (`/media/cryptofs/apps/usr/palm/applications/hotstar`). Preinstalled
(read-only) Hotstar gets a bind-mount overlay instead.

## Where the ads come from (bundle build 26.10.16.0)

| Ad type | Mechanism in the web bundle | HotsOff counter-measure |
|---|---|---|
| Live / SSAI (stitched) | Player `getClientCapabilities()` adds `"ssai"` to `client_capabilities.ads` when remote config `web.playback.enableSSAI` is on. Server answers with an ad-stitched stream + `ssai_tag` / `live_stream_ad`. | Remove `"ssai"` from every outgoing `client_capabilities` (query string, JSON body, cached storage). The app has its own identical fallback `removeSSAI()` → `ads:["non_ssai"]`. Also blank `ssai_tag`, null `live_stream_ad`, force `web.playback.enableSSAI=false`. Equivalent of the Morphe Android patch that clears `ssaiTag`. |
| VOD preroll / midroll | Player `interventions` entries with `meta.preroll` / `meta.midroll` (VAST/VMAP URLs). | Delete those meta keys, drop the intervention when nothing else is left. |
| Pause ads | `event_interventions` entry `DELAYED_PAUSE_FOR_ADS` whose `meta.compose_display` adds a `DisplayAdContainerWidget` (pause-ad widget URL) | Entry dropped; CSS hides `[data-testid="pause-ad-skin-container"]` / `.PAUSE_AD_BACKGROUND_GRADIENT` as fallback. |
| Upgrade button | Starlight side nav item `{title:"Upgrade"\|"Subscribe", default_icon, actions}` (labels from `weblr.starlight_upgrade_text`), plus `SubscriptionNudgeWidget` | Nav item and nudge widget removed from responses. |
| Home display ads | Widgets `DisplayAdWidget`, `DisplayAdContainerWidget`, `ImageDisplayAdWidget`, `VideoDisplayAdWidget` | Widget wrappers with a `*DisplayAd*` template are removed from responses. |
| Anything left | VAST / VMAP XML from the ad server | Replaced by an empty VAST/VMAP document. |
| Telemetry | Coralogix RUM, GTM, Moat, Firebase logging, hspx VTA | Blocked in the script and via `/etc/hosts` (`resources/hotstar/config/hosts.block`). |

Useful searches when the bundle changes: `getCapabilitiesProto`, `X.ads.push("ssai")`,
`removeSSAI`, `firePrerollIntervention`, `DisplayAdContainerWidget`.

## Debugging

```
ares-inspect -d <tv> --app hotstar
> __HOTSOFF__.stats      // counters: caps rewritten, json sanitized, vast emptied, blocked
```
