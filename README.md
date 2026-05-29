# Fabric Pulse

Fabric Pulse is an unofficial static GitHub Pages site for public Microsoft Fabric service status and roadmap updates.

It provides:

- A service status dashboard for public Microsoft Fabric notifications
- Static JSON endpoints for active and resolved service notifications
- A roadmap and updates page powered by mirrored Fabric GPS data
- Static JSON mirrors for Fabric GPS releases, changelog and filter options

> **Important:** Fabric Pulse is not an official Microsoft API or Microsoft service. The service status data is mirrored from the public Microsoft Fabric support page. Roadmap and update data is mirrored from the public Fabric GPS API.

## Live site

```text
https://kevinvdberge.github.io/fabric-status-api/
```

Pages:

- `/` → Service status dashboard
- `/news.html` → Microsoft Fabric roadmap and feature updates

## Data sources

### Microsoft Fabric service status

Fabric Pulse fetches:

```text
https://support.fabric.microsoft.com/support/
```

The page contains active and resolved service notifications in embedded JavaScript. The update script parses those notifications and normalizes them into static JSON files.

Because this depends on the public page structure, parsing can break if Microsoft changes the underlying HTML or JavaScript.

### Fabric GPS roadmap data

Fabric Pulse uses Fabric GPS for roadmap and update information:

```text
https://www.fabric-gps.com/endpoints
```

The GitHub Action mirrors selected Fabric GPS JSON responses into local static JSON files. This avoids browser CORS limitations and keeps the site fully static.

Mirrored Fabric GPS data includes:

- releases
- recent changelog items
- filter options for product, status and release type

## JSON endpoints

After GitHub Pages is enabled, these endpoints are available from the site root.

### Service status

- `/status.json` → metadata, counts, summary, active notifications and resolved notifications
- `/active.json` → metadata and active notifications only
- `/resolved.json` → metadata and resolved notifications only

### Roadmap and updates

- `/gps-releases.json` → mirrored Fabric GPS releases response
- `/gps-changelog.json` → mirrored Fabric GPS changelog response
- `/gps-filter-options.json` → mirrored Fabric GPS filter options response

Example:

```text
https://kevinvdberge.github.io/fabric-status-api/status.json
```

## Local usage

### Requirements

- Node.js 22+

### Install dependencies

```bash
npm ci
```

### Update all mirrored data

```bash
npm run update
```

This updates both the Microsoft Fabric service status JSON files and the Fabric GPS roadmap JSON files in `docs/`.

### Update only service status

```bash
npm run update:status
```

### Update only Fabric GPS roadmap data

```bash
npm run update:gps
```

### Validate status parser only

```bash
npm run check
```

## GitHub Pages setup

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Select the default branch.
4. Select the `/docs` folder.
5. Save.

## Automation

GitHub Actions workflow:

```text
.github/workflows/update-status.yml
```

The workflow:

- Runs on demand with `workflow_dispatch`
- Runs on pushes to `main`
- Runs every 15 minutes with `*/15 * * * *`
- Installs dependencies with `npm ci`
- Runs `npm run update`
- Commits generated `docs/` changes only when data changed

## Generated files

The workflow writes and publishes these files under `docs/`:

```text
docs/index.html
docs/news.html
docs/favicon.svg
docs/status.json
docs/active.json
docs/resolved.json
docs/gps-releases.json
docs/gps-changelog.json
docs/gps-filter-options.json
```

## Support level

Fabric Pulse is best treated as a public informational mirror. It is suitable for dashboards, lightweight monitoring and operational awareness, but it should not be considered an official Microsoft service-health contract.

For tenant-specific service health, use Microsoft Graph Service Health alongside this public mirror.
