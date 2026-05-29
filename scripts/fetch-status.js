#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const he = require('he');

const SOURCE_URL = 'https://support.fabric.microsoft.com/support/';
const SUPPORT_LEVEL =
  'Unofficial public Microsoft Fabric status mirror based on HTML scraping';
const DEFAULT_OUTPUT_DIR = 'docs';
const REGION_CANDIDATES = [
  'West Europe',
  'North Europe',
  'West US2',
  'West US',
  'East US2',
  'East US',
  'Southeast Asia',
  'Australia East',
  'UK South',
  'Central US',
  'South Central US',
  'Americas',
  'Europe',
  'Asia Pacific',
  'Middle East',
  'Africa'
];

function decodeJsString(value) {
  const body = String(value || '').trim();
  let output = '';

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      output += ch;
      continue;
    }

    i += 1;
    if (i >= body.length) break;
    const esc = body[i];

    if (esc === 'n') output += '\n';
    else if (esc === 'r') output += '\r';
    else if (esc === 't') output += '\t';
    else if (esc === 'b') output += '\b';
    else if (esc === 'f') output += '\f';
    else if (esc === 'v') output += '\v';
    else if (esc === '\\') output += '\\';
    else if (esc === '"') output += '"';
    else if (esc === "'") output += "'";
    else if (esc === '/') output += '/';
    else if (esc === 'x' && i + 2 < body.length) {
      const code = body.slice(i + 1, i + 3);
      if (/^[a-fA-F0-9]{2}$/.test(code)) {
        output += String.fromCharCode(parseInt(code, 16));
        i += 2;
      } else {
        output += esc;
      }
    } else if (esc === 'u' && i + 4 < body.length) {
      const code = body.slice(i + 1, i + 5);
      if (/^[a-fA-F0-9]{4}$/.test(code)) {
        output += String.fromCharCode(parseInt(code, 16));
        i += 4;
      } else {
        output += esc;
      }
    } else if (esc === '\n' || esc === '\r') {
      // JavaScript line continuation. Intentionally ignored.
    } else {
      output += esc;
    }
  }

  return output;
}

function parseJsLiteral(valueLiteral) {
  let value = String(valueLiteral || '').trim();
  value = value.replace(/;\s*$/, '').trim();

  if (!value || /^(null|undefined)$/i.test(value)) return '';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return decodeJsString(value.slice(1, -1));
  }

  return value;
}

function parseNotificationBlocks(html, kind) {
  const results = [];
  const objectName = `ServiceStatus${kind}Notification`;
  const listName = `serviceStatusNotification${kind}List`;
  const blockRegex = new RegExp(
    `${objectName}\\s*=\\s*new\\s+Object\\(\\s*\\)\\s*;?([\\s\\S]*?)${listName}\\.push\\(\\s*${objectName}\\s*\\)\\s*;`,
    'g'
  );

  let blockMatch;
  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const block = blockMatch[1];
    const notification = {};
    const fieldRegex = new RegExp(
      `${objectName}\\.([A-Za-z0-9_]+)\\s*=\\s*([\\s\\S]*?)(?=\\r?\\n\\s*${objectName}\\.[A-Za-z0-9_]+\\s*=|\\r?\\n\\s*${listName}\\.push|$)`,
      'g'
    );

    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(block)) !== null) {
      const [, field, rawValue] = fieldMatch;
      notification[field] = parseJsLiteral(rawValue);
    }

    results.push(notification);
  }

  return results;
}

function parseNotifications(html) {
  return {
    activeRaw: parseNotificationBlocks(html, 'Active'),
    resolvedRaw: parseNotificationBlocks(html, 'Resolved')
  };
}

function stripHtml(html) {
  return he
    .decode(String(html || ''))
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateToIso(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return null;

  return new Date(timestamp).toISOString();
}

function extractRegion(explicitRegion, detailsText) {
  const normalizedRegion = String(explicitRegion || '').trim();
  if (normalizedRegion) return normalizedRegion;

  for (const region of REGION_CANDIDATES) {
    const escaped = region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(detailsText)) return region;
  }

  return '';
}

function buildHash(notification) {
  const key = [
    notification.serviceNotificationId,
    notification.serviceStatus,
    notification.detailsText,
    notification.reportedAt,
    notification.resolvedAt
  ]
    .map((value) => String(value || ''))
    .join('|');

  return crypto.createHash('sha256').update(key).digest('hex');
}

function normalizeNotification(item, type) {
  const detailsHtml = he.decode(String(item.details || '')).trim();
  const detailsText = stripHtml(detailsHtml);
  const reportedRaw = String(item.reported || '').trim();
  const resolvedRaw = String(item.resolved || '').trim();

  const normalized = {
    type,
    serviceNotificationId: String(item.serviceNotificationId || '').trim(),
    serviceStatus: String(item.serviceStatus || '').trim(),
    region: extractRegion(item.region, detailsText),
    reportedRaw,
    reportedAt: parseDateToIso(reportedRaw),
    resolvedRaw,
    resolvedAt: parseDateToIso(resolvedRaw),
    detailsHtml,
    detailsText
  };

  normalized.hash = buildHash(normalized);
  return normalized;
}

function scoreActive(item) {
  return item.reportedAt ? Date.parse(item.reportedAt) : Number.NEGATIVE_INFINITY;
}

function scoreResolved(item) {
  const resolved = item.resolvedAt ? Date.parse(item.resolvedAt) : Number.NEGATIVE_INFINITY;
  if (resolved > Number.NEGATIVE_INFINITY) return resolved;
  return item.reportedAt ? Date.parse(item.reportedAt) : Number.NEGATIVE_INFINITY;
}

function dedupeById(items, scoreFn) {
  const byId = new Map();
  const withoutId = [];

  for (const item of items) {
    if (!item.serviceNotificationId) {
      withoutId.push(item);
      continue;
    }

    const existing = byId.get(item.serviceNotificationId);
    if (!existing || scoreFn(item) > scoreFn(existing)) {
      byId.set(item.serviceNotificationId, item);
    }
  }

  return [...byId.values(), ...withoutId];
}

function buildPayload(active, resolved, generatedAt) {
  const counts = {
    active: active.length,
    resolved: resolved.length,
    total: active.length + resolved.length
  };

  return {
    generatedAt,
    sourceUrl: SOURCE_URL,
    supportLevel: SUPPORT_LEVEL,
    counts,
    summary: {
      activeIncidents: counts.active,
      resolvedIncidents: counts.resolved,
      hasActive: counts.active > 0
    },
    active,
    resolved
  };
}

async function writeOutputFiles(outputDir, generatedAt, active, resolved, status) {
  await fs.mkdir(outputDir, { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(outputDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`),
    fs.writeFile(
      path.join(outputDir, 'active.json'),
      `${JSON.stringify(
        {
          generatedAt,
          sourceUrl: SOURCE_URL,
          supportLevel: SUPPORT_LEVEL,
          count: active.length,
          active
        },
        null,
        2
      )}\n`
    ),
    fs.writeFile(
      path.join(outputDir, 'resolved.json'),
      `${JSON.stringify(
        {
          generatedAt,
          sourceUrl: SOURCE_URL,
          supportLevel: SUPPORT_LEVEL,
          count: resolved.length,
          resolved
        },
        null,
        2
      )}\n`
    )
  ]);
}

function getOutputDir() {
  const configured = process.env.STATUS_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  return path.resolve(__dirname, '..', configured);
}

async function main() {
  const checkMode = process.argv.includes('--check');

  let response;
  try {
    response = await fetch(SOURCE_URL, {
      headers: {
        'user-agent': 'fabric-status-api/1.0 (+https://github.com/kevinvdberge/fabric-status-api)'
      }
    });
  } catch (error) {
    throw new Error(`Failed to fetch source page: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch source page (${response.status} ${response.statusText})`);
  }

  const html = await response.text();
  const { activeRaw, resolvedRaw } = parseNotifications(html);

  const active = dedupeById(
    activeRaw.map((item) => normalizeNotification(item, 'active')),
    scoreActive
  ).sort((a, b) => scoreActive(b) - scoreActive(a));

  const resolved = dedupeById(
    resolvedRaw.map((item) => normalizeNotification(item, 'resolved')),
    scoreResolved
  ).sort((a, b) => scoreResolved(b) - scoreResolved(a));

  if (active.length === 0 && resolved.length === 0) {
    throw new Error(
      'Parser found no active or resolved notifications. The source page structure may have changed.'
    );
  }

  const generatedAt = new Date().toISOString();
  const status = buildPayload(active, resolved, generatedAt);

  if (checkMode) {
    console.log(`Check succeeded. Active: ${active.length}, Resolved: ${resolved.length}`);
    return;
  }

  const outputDir = getOutputDir();
  await writeOutputFiles(outputDir, generatedAt, active, resolved, status);
  console.log(`Updated status files in ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
