# Host Presets Admin Portal

Single-page admin portal for managing provider host pools used by the app login preset selector and host failover.

## Files

- `index.html` - page shell
- `styles.css` - page styles
- `app.js` - auth + ACL + provider/host CRUD logic
- `firebase-config.js` - Firebase web config used by the page
- `firebase-config.example.js` - template for new Firebase projects

## Firebase setup (required)

1. Open Firebase Console for `gic-iptv-tracker`.
2. Enable **Authentication -> Sign-in method -> Email/Password**.
3. Create admin users in **Authentication -> Users** (or use `Create User` in portal).
4. Enable **Realtime Database** and use this DB URL:
   - `https://gic-iptv-tracker-default-rtdb.europe-west1.firebasedatabase.app`
5. In Realtime Database rules, apply the rules from `firebase-rules.host-presets.json`.

## ACL setup (required per admin user)

Each admin account must have ACL under:

- `hostPresets/v1/adminAcl/{uid}`

Example value:

```json
{
  "email": "admin@example.com",
  "superAdmin": false,
  "providers": {
    "tiger_iptv": true,
    "tera_iptv": true
  },
  "updatedAtMs": 0
}
```

Notes:
- `superAdmin: true` can manage all providers.
- Non-super admins can only manage providers listed in `providers` map.

## Deploy on GitHub Pages

1. Push folder `web/host-presets-admin/` to your repo.
2. In GitHub repo settings, enable **Pages**.
3. Source:
   - Branch: `main` (or your branch)
   - Folder: `/web/host-presets-admin` (or `/docs` if you move it)
4. Open the generated GitHub Pages URL.
5. Sign in with Firebase admin user.

## Portal usage

1. Sign in with email/password.
2. If ACL is missing, page shows UID and ACL JSON sample.
3. Add/edit providers.
4. Add hosts for each provider with:
   - `hostId` slug (`[a-z0-9_-]`) or leave empty to auto-generate from hostname
   - absolute `baseUrl` (`http://host:port` or `https://host:port`)
   - `order` (lower = tried first)
   - `enabled` (disabled hosts are skipped by app)

## App integration path

Android app reads:

- `hostPresets/v1/providers/{providerId}`
- `hostPresets/v1/providers/{providerId}/hosts/{hostId}`

Login flow:
- User can choose `Manual` host or a preset provider.
- If preset provider is selected, app tries enabled hosts by `order`.
- If first host fails live catalog fetch, app tries next host automatically.
