# fabric-status-api

Unofficial static JSON API for the public Microsoft Fabric service status page.

> ⚠️ **Important:** This project is not an official Microsoft API. It mirrors public status data by scraping HTML/embedded JavaScript from the Fabric support page.

## What this project does

- Fetches `https://support.fabric.microsoft.com/support/`
- Parses active and resolved notifications from embedded JavaScript lists
- Normalizes output into stable JSON files in `/public`
- Publishes files via GitHub Pages

## Unofficial support level

`Unofficial public Microsoft Fabric status mirror based on HTML scraping`

Because this relies on page structure, parsing can break if Microsoft updates the source HTML/JavaScript.

## Local usage

### Requirements

- Node.js 22+

### Install

```bash
npm ci
```

### Fetch and write JSON

```bash
npm run update
```

### Parse/validate only (no writes)

```bash
npm run check
```

## Enable GitHub Pages

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Select your default branch and `/public` folder.
4. Save.

## JSON endpoints

After Pages is enabled, files are available at:

- `/status.json` → metadata + counts + summary + active + resolved
- `/active.json` → metadata + active notifications only
- `/resolved.json` → metadata + resolved notifications only

Example base URL:

- `https://<your-user>.github.io/fabric-status-api/status.json`

## Use from n8n

1. Add an **HTTP Request** node.
2. Set method to `GET`.
3. Set URL to your `status.json` endpoint.
4. Use the JSON in downstream nodes (for example IF/Switch nodes on `summary.hasActive`, loops over `active`, etc.).

## Automation

GitHub Actions workflow: `.github/workflows/update-status.yml`

- Runs on demand (`workflow_dispatch`)
- Runs every 15 minutes at offset minutes (`7,22,37,52`)
- Installs dependencies with `npm ci`
- Runs `npm run update`
- Commits `public/` changes only when there are changes
