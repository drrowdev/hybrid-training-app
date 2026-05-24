# Install the app on iPhone

The Hybrid Training app can run as a full-screen "app" on iOS without any App Store listing or paid Apple Developer account. It installs from Safari as a PWA (Progressive Web App).

## Quick install

1. Open the production URL in **Safari** on your iPhone (other browsers don't expose Add-to-Home-Screen on iOS).
2. Tap the **Share** button — the square with the up-arrow at the bottom of the screen.
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name (defaults to **Hybrid**) and tap **Add** in the top-right.
5. The icon appears on your home screen. Tap it.

The app launches full-screen with no Safari URL bar or tab strip. Sign in once; the auth session persists across launches.

## Updating to the latest version

The app is still a web app under the hood, so deploys ship instantly — no App Store review wait. To pick up the latest version:

- **Pull down on the page** from the top to trigger a refresh. The custom pull-to-refresh indicator (a small spinner under the status bar) replaces Safari's native one, which iOS disables in standalone mode.
- Or fully close the app from the iOS app switcher and reopen it.

## Known iOS limitations

- **Haptic feedback** is unavailable on iOS web — Apple hasn't shipped the Vibration API for Safari.
- **Background sync** doesn't run — data sync only happens while the app is open.
- **Push notifications** require iOS 16.4 or newer and an explicit permission grant.
- **First launch after install** sometimes shows a brief solid-colour splash while the engine warms up; this is the manifest `background_color` and is expected.

## Troubleshooting

- **Icon shows a tiny screenshot instead of the H logo** — clear the icon by deleting it from the home screen, reload the page in Safari, then re-add. Safari caches the apple-touch-icon on first install.
- **App opens in Safari with a URL bar** instead of full-screen — the icon was added before the manifest was deployed. Delete and re-add.
- **Pull-to-refresh doesn't fire** — confirm you're starting the drag at the very top of the page (scroll position 0). The gesture only engages once the page is fully scrolled up.
