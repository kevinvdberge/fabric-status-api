#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const he = require('he');

const SOURCE_URL = 'https://support.fabric.microsoft.com/support/';
const SUPPORT_LEVEL =
  'Unofficial public Microsoft Fabric status mirror based on HTML scraping';
const REGION_CANDIDATES = [
  'West Europe',
  'North Europe',
  'West US',
  'West US2',
  'East US',
  'East US2',
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

// Split JavaScript source into statement-like chunks while respecting quoted strings.
function splitJsStatements(source) {
  const statements = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    current += ch;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === ';') {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

function splitByPlusOutsideQuotes(value) {
  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '+') {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseJsLiteral(valueLiteral) {
  const value = valueLiteral.trim();

  if (!value) return '';

  // Handle multiline/details assignments that concatenate string literals.
  if (value.includes('+')) {
    const parts = splitByPlusOutsideQuotes(value);
    if (
      parts.length > 1 &&
      parts.every(
        (part) =>
          (part.startsWith('"') && part.endsWith('"')) ||
          (part.startsWith("'") && part.endsWith("'"))
      )
    ) {
      return parts.map((part) => parseJsLiteral(part)).join('');
    }
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const quote = value[0];
    const body = value.slice(1, -1);
    let out = '';

    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch !== '\\') {
        out += ch;
        continue;
      }

      i += 1;
      if (i >= body.length) break;
      const esc = body[i];

      if (esc === 'n') out += '\n';
      else if (esc === 'r') out += '\r';
      else if (esc === 't') out += '\t';
      else if (esc === 'b') out += '\b';
      else if (esc === 'f') out += '\f';
      else if (esc === 'v') out += '\v';
      else if (esc === '\\') out += '\\';
      else if (esc === '"') out += '"';
      else if (esc === "'") out += "'";
      else if (esc === '/') out += '/';
      else if (esc === 'x' && i + 2 < body.length) {
        const code = body.slice(i + 1, i + 3);
        if (/^[a-fA-F0-9]{2}$/.test(code)) {
          out += String.fromCharCode(parseInt(code, 16));
          i += 2;
        } else {
          out += esc;
        }
      } else if (esc === 'u' && i + 4 < body.length) {
        const code = body.slice(i + 1, i + 5);
        if (/^[a-fA-F0-9]{4}$/.test(code)) {
          out += String.fromCharCode(parseInt(code, 16));
          i += 4;
        } else {
          out += esc;
        }
      } else if (esc === '\n' || esc === '\r') {
        // Handle line continuation in JavaScript string literals.
      } else if (esc === quote) {
        out += quote;
      } else {
        out += esc;
      }
    }

    return out;
  }

  if (/^(null|undefined)$/i.test(value)) return '';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseNotifications(html) {
  const scriptBlocks = [];
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;

  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    scriptBlocks.push(scriptMatch[1]);
  }

  const statements = splitJsStatements(scriptBlocks.join('\n'));
  const objects = {
    ServiceStatusActiveNotification: {},
    ServiceStatusResolvedNotification: {}
  };
  const activeRaw = [];
  const resolvedRaw = [];

  for (const statement of statements) {
    const resetMatch = statement.match(
      /^(?:var|let|const)?\s*(ServiceStatus(?:Active|Resolved)Notification)\s*=\s*new\s+Object\(\s*\)$/
    );
    if (resetMatch) {
      objects[resetMatch[1]] = {};
      continue;
    }

    const assignMatch = statement.match(
      /^(ServiceStatus(?:Active|Resolved)Notification)\.([A-Za-z0-9_]+)\s*=\s*([\s\S]+)$/
    );
    if (assignMatch) {
      const [, objName, field, rawValue] = assignMatch;
      objects[objName][field] = parseJsLiteral(rawValue);
      continue;
    }

    const pushMatch = statement.match(
      /^(serviceStatusNotificationActiveList|serviceStatusNotificationResolvedList)\.push\((ServiceStatus(?:Active|Resolved)Notification)\)$/
    );
    if (pushMatch) {
      const [, listName, objName] = pushMatch;
      const copy = { ...objects[objName] };
      if (listName === 'serviceStatusNotificationActiveList') {
        activeRaw.push(copy);
      } else {
        resolvedRaw.push(copy);
      }
    }
  }

  return { activeRaw, resolvedRaw };
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
    if (regex.test(detailsText)) {
      return region;
    }
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
  const region = extractRegion(item.region, detailsText);

  const normalized = {
    type,
    serviceNotificationId: String(item.serviceNotificationId || '').trim(),
    serviceStatus: String(item.serviceStatus || '').trim(),
    region,
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

  const outputDir = path.resolve(__dirname, '..', 'public');
  await writeOutputFiles(outputDir, generatedAt, active, resolved, status);
  console.log(`Updated status files in ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
