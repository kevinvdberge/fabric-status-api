#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://www.fabric-gps.com';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'docs');

async function fetchJson(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'fabric-status-api/1.0 (+https://github.com/kevinvdberge/fabric-status-api)'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function writeJson(fileName, payload) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const generatedAt = new Date().toISOString();

  const [releases, changelog, filterOptions] = await Promise.all([
    fetchJson('/api/releases?page_size=100&sort=last_modified'),
    fetchJson('/api/changelog?days=30'),
    fetchJson('/api/filter-options')
  ]);

  const releaseItems = Array.isArray(releases.data) ? releases.data : [];
  const changeItems = Array.isArray(changelog.days)
    ? changelog.days.flatMap((day) => day.items || [])
    : [];

  await Promise.all([
    writeJson('gps-releases.json', {
      generatedAt,
      sourceUrl: `${API_BASE}/api/releases?page_size=100&sort=last_modified`,
      count: releaseItems.length,
      releases
    }),
    writeJson('gps-changelog.json', {
      generatedAt,
      sourceUrl: `${API_BASE}/api/changelog?days=30`,
      count: changeItems.length,
      changelog
    }),
    writeJson('gps-filter-options.json', {
      generatedAt,
      sourceUrl: `${API_BASE}/api/filter-options`,
      filterOptions
    })
  ]);

  console.log(`Updated Fabric GPS files in ${OUTPUT_DIR}`);
  console.log(`Releases: ${releaseItems.length}, changes: ${changeItems.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
