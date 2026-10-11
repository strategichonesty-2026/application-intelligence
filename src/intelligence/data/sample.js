// DEVELOPMENT-ONLY fixtures, reached via  #/intelligence?sample=<scenario>.
// api.js loads this module only when import.meta.env.DEV is true, and the UI
// shows a "Sample data" banner whenever it is active. The figures are fictional.
//
// Scenarios: mixed (default) · healthy · empty · stale · monitoring · error · auth · loading

import { ApiError } from './api';

const MIN = 60000;
const iso = (agoMs) => new Date(Date.now() - agoMs).toISOString();

const check = (over = {}) => ({
  type: 'health_endpoint', typeLabel: 'Health endpoint',
  limitation: 'Confirms that the dedicated health endpoint answers as expected. It is only as thorough as the checks the application runs behind that endpoint.',
  path: '/health', endpoint: '', expectedStatus: 200, intervalSeconds: 300, timeoutMs: 8000, slowThresholdMs: 2000, staleAfterSeconds: 900, ...over,
});
const HOME = {
  type: 'homepage', typeLabel: 'Homepage reachability', path: null,
  limitation: 'Confirms that the registered URL answers. It does not prove the application, its database, or its integrations work, so it is never reported as Healthy.',
};

function app(id, name, o) {
  const url = o.url || `https://${id}.example.test`;
  return {
    id, name, description: o.description || '', url, environment: o.environment || 'production',
    status: 'healthy', statusNote: '', monitoringFault: false, enabled: true,
    check: check({ ...(o.check || {}), endpoint: url + ((o.check && o.check.path) ? o.check.path : (o.check && o.check.type === 'homepage') ? '' : '/health') }),
    lastCheckedAt: iso(2 * MIN), lastSuccessAt: iso(2 * MIN), lastOutcome: 'ok', lastReason: null, lastSummary: null,
    lastHttpStatus: 200, responseMs: 180, consecutiveFailures: 0, latestIncident: null, createdAt: iso(30 * 24 * 60 * MIN),
    ...o.fields,
  };
}

const incident = (id, applicationId, applicationName, o) => ({
  kind: 'application', id: String(id), applicationId, applicationName, applicationUrl: `https://${applicationId}.example.test`, environment: 'production',
  status: 'resolved', severity: 'critical', reason: 'timeout', summary: 'No response within 8 seconds.',
  firstDetectedAt: iso(300 * MIN), lastFailureAt: iso(280 * MIN), resolvedAt: iso(270 * MIN), failureCount: 4, ...o,
});

function build(scenario) {
  const base = [
    app('storefront', 'Customer Storefront', { description: 'Public shop used by customers to browse and order.', fields: { responseMs: 240 } }),
    app('orders-api', 'Orders API', {
      description: 'Internal API that processes and stores orders.',
      fields: {
        status: 'unhealthy', statusNote: 'Health check failed four times in a row', lastCheckedAt: iso(1 * MIN), lastSuccessAt: iso(47 * MIN), lastOutcome: 'failed', lastReason: 'timeout',
        lastSummary: 'No response within 8 seconds.', lastHttpStatus: null, responseMs: null, consecutiveFailures: 4,
        latestIncident: incident(101, 'orders-api', 'Orders API', { status: 'open', resolvedAt: null, firstDetectedAt: iso(32 * MIN), lastFailureAt: iso(1 * MIN), failureCount: 4 }),
      },
    }),
    app('support-portal', 'Support Portal', {
      description: 'Where customers raise and track support requests.',
      fields: { status: 'degraded', lastOutcome: 'degraded', lastReason: 'slow_response', lastSummary: 'Responded, but slower than the 2000 ms limit.', responseMs: 3120, consecutiveFailures: 2 },
    }),
    app('marketing-site', 'Marketing Site', {
      description: 'Brand website. Only its homepage is checked.', check: HOME,
      fields: { status: 'reachable', statusNote: 'The URL answers. Homepage checks cannot confirm the application is healthy.', responseMs: 95, latestIncident: incident(88, 'marketing-site', 'Marketing Site', { firstDetectedAt: iso(3 * 24 * 60 * MIN), lastFailureAt: iso(3 * 24 * 60 * MIN - 10 * MIN), resolvedAt: iso(3 * 24 * 60 * MIN - 25 * MIN), reason: 'http_5xx', summary: 'The application answered with a server error (HTTP 503).', failureCount: 3 }) },
    }),
    app('staging-admin', 'Admin Console (staging)', {
      environment: 'staging', description: 'Staging copy of the admin console.',
      fields: { status: 'unknown', lastOutcome: 'inconclusive', lastReason: 'auth_required', lastSummary: 'The endpoint answered HTTP 401 and requires authentication, so health cannot be verified.', lastHttpStatus: 401, responseMs: 110 },
    }),
    app('reports', 'Reporting Service', {
      description: 'Nightly reports.', fields: { status: 'paused', enabled: false, lastCheckedAt: iso(2 * 24 * 60 * MIN), lastSuccessAt: iso(2 * 24 * 60 * MIN), responseMs: 410 },
    }),
  ];
  if (scenario === 'healthy') {
    return [base[0], app('billing', 'Billing Service', { description: 'Handles invoices.', fields: { responseMs: 130 } }), app('search', 'Search', { description: 'Site search.', fields: { responseMs: 310 } })];
  }
  if (scenario === 'empty') return [];
  if (scenario === 'stale') {
    return base.slice(0, 3).map((a, i) => ({
      ...a, status: 'stale', statusNote: 'No recent check. The last known result may be out of date.', lastCheckedAt: iso((3 + i) * 60 * MIN),
      latestIncident: null, consecutiveFailures: 0, lastOutcome: 'ok', responseMs: 200,
    }));
  }
  if (scenario === 'monitoring') {
    return [base[0], { ...base[2], status: 'unknown', monitoringFault: true, lastOutcome: 'monitor_error', lastSummary: 'The monitoring service refused to check this address because it points to a private or internal network.', responseMs: null, consecutiveFailures: 0 }];
  }
  return base;
}

function summaryFor(apps, scenario) {
  const counts = { total: apps.length, healthy: 0, reachableOnly: 0, attention: 0, unknown: 0, paused: 0, activeIncidents: 0 };
  apps.forEach((a) => {
    if (a.status === 'healthy') counts.healthy += 1;
    if (a.status === 'reachable') counts.reachableOnly += 1;
    if (a.status === 'paused') counts.paused += 1;
    if (a.status === 'unknown' || a.status === 'pending') counts.unknown += 1;
    if (['degraded', 'unhealthy', 'stale'].includes(a.status) || a.monitoringFault) counts.attention += 1;
    if (a.latestIncident && a.latestIncident.status === 'open') counts.activeIncidents += 1;
  });
  const stale = scenario === 'stale';
  return {
    success: true, generatedAt: iso(0), environment: 'development', counts,
    monitoring: {
      running: !stale && apps.length > 0 || scenario === 'empty', lastTickAt: stale ? iso(4 * 60 * MIN) : iso(0.5 * MIN), lastTickError: null, tickSeconds: 60,
      lastCheckRecordedAt: apps.length ? (stale ? iso(3 * 60 * MIN) : iso(1 * MIN)) : null, hasIncidentHistory: counts.activeIncidents > 0,
      lastCycleCompletedAt: stale ? iso(3 * 60 * MIN) : iso(0.5 * MIN),
      health: apps.length === 0 ? { state: 'no_applications', ageSeconds: null } : stale ? { state: 'stalled', lastCycleCompletedAt: iso(3 * 60 * MIN), ageSeconds: 10800 } : { state: 'ok', lastCycleCompletedAt: iso(0.5 * MIN), ageSeconds: 30 }, alerting: { configured: scenario !== 'empty' },
      heartbeat: { configured: true, valid: true, lastSuccessAt: stale ? iso(3 * 60 * MIN) : iso(0.5 * MIN), lastError: null },
    },
  };
}

function timeline(apps) {
  const items = [];
  apps.forEach((a) => { if (a.latestIncident) items.push(a.latestIncident); });
  items.push(incident(90, 'storefront', 'Customer Storefront', { firstDetectedAt: iso(26 * 60 * MIN), lastFailureAt: iso(26 * 60 * MIN - 12 * MIN), resolvedAt: iso(26 * 60 * MIN - 24 * MIN), reason: 'dns_failure', summary: 'The domain name could not be resolved.', failureCount: 3 }));
  items.push(incident(92, 'support-portal', 'Support Portal', { severity: 'warning', reason: 'slow_response', summary: 'Responded, but slower than the 2000 ms limit.', firstDetectedAt: iso(5 * 60 * MIN), lastFailureAt: iso(4.5 * 60 * MIN), resolvedAt: iso(4 * 60 * MIN), failureCount: 5 }));
  items.push({
    kind: 'monitoring', id: 'c501', applicationId: 'staging-admin', applicationName: 'Admin Console (staging)', applicationUrl: 'https://staging-admin.example.test', environment: 'staging',
    status: 'recorded', severity: 'warning', reason: 'monitor_internal', summary: 'The monitoring service hit an internal error while running this check. The application may be fine.',
    firstDetectedAt: iso(9 * 60 * MIN), lastFailureAt: iso(9 * 60 * MIN), resolvedAt: null, failureCount: 1,
  });
  return items.sort((a, b) => new Date(b.lastFailureAt) - new Date(a.lastFailureAt));
}

function checksFor(apps) {
  const out = []; let id = 1;
  apps.forEach((a, ai) => {
    for (let i = 0; i < 6; i += 1) {
      const failing = a.status === 'unhealthy' && i < 4;
      out.push({
        id: id++, applicationId: a.id, applicationName: a.name, checkedAt: iso((i * 5 + ai) * MIN + 40000),
        outcome: failing ? 'failed' : a.status === 'degraded' && i < 2 ? 'degraded' : 'ok',
        reason: failing ? 'timeout' : null, summary: failing ? 'No response within 8 seconds.' : null,
        httpStatus: failing ? null : 200, responseMs: failing ? null : 120 + ((i * 37 + ai * 53) % 160) + (a.status === 'degraded' && i < 2 ? 2800 : 0), trigger: i === 5 ? 'registration' : 'scheduled',
      });
    }
  });
  return out.sort((x, y) => new Date(y.checkedAt) - new Date(x.checkedAt));
}

function historyFor(a, range) {
  const spanMin = { '1h': 60, '24h': 1440, '7d': 10080 }[range] || 1440;
  const step = Math.max(5, Math.round(spanMin / 60));
  const pts = [];
  for (let m = spanMin; m >= 0; m -= step) {
    const wobble = 140 + Math.round(60 * Math.sin(m / 37)) + ((m * 7) % 45);
    const down = a.status === 'unhealthy' && m < 25;
    pts.push({ checkedAt: iso(m * MIN), outcome: down ? 'failed' : 'ok', responseMs: down ? null : wobble + (a.status === 'degraded' && m < 90 ? 2600 : 0), httpStatus: down ? null : 200 });
  }
  return pts;
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
});

export async function handleSample(scenario, method, path, body, signal) {
  await wait(scenario === 'loading' ? 600000 : 250, signal);
  if (scenario === 'error') throw new ApiError('unavailable', 'The monitoring API did not respond.');
  if (scenario === 'auth') throw new ApiError('auth', 'Not authorised.');
  const apps = build(scenario);
  const [route, query = ''] = path.split('?');
  const params = new URLSearchParams(query);

  if (method !== 'GET') {
    if (method === 'POST' && route === '/alerts/test') return { success: true, message: 'The email provider accepted the test message. This confirms the provider took it, not that it reached the inbox. Check your inbox (and spam) to confirm.' };
    if (method === 'POST' && route === '/applications') return { success: true, application: { ...apps[0], name: body.name } };
    if (method === 'POST' && route.endsWith('/check')) return { success: true, result: { outcome: 'ok', summary: null, httpStatus: 200, responseMs: 142 }, application: apps[0] };
    if (method === 'PATCH') return { success: true, application: { ...apps.find((a) => route.endsWith(a.id)) || apps[0], ...body } };
    return { success: true };
  }
  if (route === '/summary') return summaryFor(apps, scenario);
  if (route === '/config') {
    return { success: true, environment: 'development', environments: ['production', 'staging', 'development'], rules: { failuresToOpenIncident: 3, successesToResolve: 2, retentionDays: 30 }, monitoring: summaryFor(apps, scenario).monitoring, privateTargetsAllowed: true, alerting: { configured: true }, heartbeat: { configured: true, valid: true, error: null } };
  }
  if (route === '/alerts/config') {
    const on = scenario !== 'empty';
    return { success: true, configured: on, provider: 'resend', missing: on ? [] : ['RESEND_API_KEY', 'ALERT_EMAIL_FROM', 'ALERT_EMAIL_TO'], invalid: [], recipients: on ? ['o•••@example.com'] : [], message: on ? 'Email alerts are configured.' : 'Email alerts are not configured. RESEND_API_KEY is not set; ALERT_EMAIL_FROM is not set; ALERT_EMAIL_TO is not set.', maxAttempts: 5, retryBackoffMinutes: [1, 5, 15, 60] };
  }
  if (route === '/alerts') {
    return { success: true, alerts: scenario === 'empty' ? [] : [
      { id: 3, event: 'recovered', applicationId: 'storefront', applicationName: 'Customer Storefront', subject: 's', status: 'sent', attempts: 1, lastError: null, providerId: 'abcd1234…', createdAt: iso(25 * 60 * MIN), sentAt: iso(25 * 60 * MIN) },
      { id: 2, event: 'opened', applicationId: 'orders-api', applicationName: 'Orders API', subject: 's', status: 'pending', attempts: 2, lastError: 'Email provider answered HTTP 503.', providerId: null, createdAt: iso(31 * MIN), nextAttemptAt: iso(-4 * MIN) },
      { id: 1, event: 'opened', applicationId: 'storefront', applicationName: 'Customer Storefront', subject: 's', status: 'failed', attempts: 1, lastError: 'Email provider answered HTTP 401. Check RESEND_API_KEY and that ALERT_EMAIL_FROM uses a verified domain.', providerId: null, createdAt: iso(27 * 60 * MIN) },
    ] };
  }
  if (route === '/applications') return { success: true, generatedAt: iso(0), applications: apps };
  const hist = route.match(/^\/applications\/([^/]+)\/history$/);
  if (hist) {
    const a = apps.find((x) => x.id === decodeURIComponent(hist[1]));
    if (!a) throw new ApiError('notfound', 'This application is not registered.');
    const range = params.get('range') || '24h';
    return { success: true, range, points: scenario === 'new' ? [] : historyFor(a, range) };
  }
  const one = route.match(/^\/applications\/([^/]+)$/);
  if (one) {
    const a = apps.find((x) => x.id === decodeURIComponent(one[1]));
    if (!a) throw new ApiError('notfound', 'This application is not registered.');
    return { success: true, application: a, incidents: timeline(apps).filter((i) => i.applicationId === a.id).slice(0, 10), recentChecks: checksFor([a]).slice(0, 8) };
  }
  if (route === '/incidents') {
    let items = apps.length ? timeline(apps) : [];
    const f = (k) => params.get(k);
    if (f('application')) items = items.filter((i) => i.applicationId === f('application'));
    if (f('status')) items = items.filter((i) => i.status === f('status'));
    if (f('severity')) items = items.filter((i) => i.severity === f('severity') && i.kind !== 'monitoring');
    if (f('kind')) items = items.filter((i) => i.kind === f('kind'));
    const hours = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 }[f('range')];
    if (hours) items = items.filter((i) => Date.now() - new Date(i.lastFailureAt) < hours * 3600000);
    const pageSize = Number(f('pageSize')) || 20; const page = Number(f('page')) || 1;
    return { success: true, generatedAt: iso(0), total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
  }
  if (route === '/activity') {
    let checks = checksFor(apps);
    if (params.get('application')) checks = checks.filter((c) => c.applicationId === params.get('application'));
    return { success: true, generatedAt: iso(0), checks: checks.slice(0, Number(params.get('limit')) || 15) };
  }
  throw new ApiError('notfound', 'Unknown sample route.');
}
