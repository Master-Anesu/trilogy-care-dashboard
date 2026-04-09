/**
 * Trilogy Care — AI Nudge + Email Worker
 * ─────────────────────────────────────────────────────────────────────
 * Handles two routes:
 *   POST /nudge  → proxies to Anthropic API (AI coaching nudge)
 *   POST /email  → sends HCA follow-up email via Resend
 *
 * Required environment secrets (set via wrangler secret put):
 *   ANTHROPIC_API_KEY   — your sk-ant-... key
 *   RESEND_API_KEY      — your re_... key from resend.com (free tier: 3000/mo)
 *   FROM_EMAIL          — verified sender, e.g. nudges@yourdomain.com
 *
 * Deploy:
 *   npm install -g wrangler
 *   npx wrangler login
 *   npx wrangler deploy worker.js --name trilogy-care-nudge --compatibility-date 2024-01-01
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler secret put RESEND_API_KEY
 *   npx wrangler secret put FROM_EMAIL
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    const url = new URL(request.url);
    const path = url.pathname;

    // ── /nudge — AI coaching nudge via Anthropic ───────────────────────
    if (path === '/nudge' || path === '/') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
      try {
        const body = await request.json();
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            messages: body.messages,
          }),
        });
        const data = await resp.json();
        return json(data, resp.status);
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── /email — send HCA follow-up nudge email via Resend ─────────────
    if (path === '/email') {
      if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 500);
      if (!env.FROM_EMAIL)     return json({ error: 'FROM_EMAIL not configured' }, 500);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { to, to_name, consumer_name, hcp, cp_stage, days_inactive, closing_overdue, gaps, zoho_url } = body;
      if (!to || !consumer_name) return json({ error: 'Missing required fields: to, consumer_name' }, 400);

      // In test mode (onboarding@resend.dev), route all emails to TEST_EMAIL or account owner
      const actualTo = env.TEST_EMAIL || to;
      const subject = `Action required: ${consumer_name} — HCA follow-up overdue`;
      const gap_list = (gaps || []).map(g => `<li style="margin-bottom:6px">${g}</li>`).join('');
      const zoho_btn = zoho_url
        ? `<a href="${zoho_url}" style="display:inline-block;margin-top:18px;background:#5b6cff;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:500">Open in Zoho CRM →</a>`
        : '';

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <tr><td style="background:#0e0f11;padding:20px 32px;display:flex;align-items:center">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.05em">TRILOGY <span style="color:#5b6cff">CARE</span></span>
          <span style="color:#555b68;font-size:12px;margin-left:16px;font-family:monospace"> · HCA Follow-Up Alert</span>
        </td></tr>
        <tr><td style="padding:32px">
          <h2 style="margin:0 0 8px;font-size:20px;color:#0e0f11">Action required: ${consumer_name}</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px">Hi ${to_name || 'there'},</p>
          <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6">
            This consumer requires your immediate follow-up. The verbal HCA confirmation has not been completed and the closing date is overdue.
          </p>
          <table style="width:100%;background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;border-collapse:collapse">
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:130px">Consumer</td><td style="font-size:13px;color:#111827;font-weight:500">${consumer_name}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">HCP Level</td><td style="font-size:13px;color:#111827">${hcp || '—'}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">CP Stage</td><td style="font-size:13px;color:#111827">${cp_stage || 'Not started'}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Days inactive</td><td style="font-size:13px;color:#ef4444;font-weight:500">${days_inactive || 0} days</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Closing overdue</td><td style="font-size:13px;color:#ef4444;font-weight:500">${closing_overdue || 0} days</td></tr>
          </table>
          ${gap_list ? `
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151">Outstanding issues:</p>
          <ul style="margin:0 0 20px;padding-left:20px;color:#6b7280;font-size:13px;line-height:1.8">${gap_list}</ul>
          ` : ''}
          <div style="background:#fef3c7;border-radius:8px;padding:14px 16px;margin-bottom:20px;border-left:4px solid #f59e0b">
            <p style="margin:0;font-size:13px;color:#92400e;font-weight:500">⚡ Priority action: Make the verbal HCA confirmation call today and log it in Zoho.</p>
          </div>
          ${zoho_btn}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0">
          <p style="margin:0;font-size:12px;color:#9ca3af">This alert was sent by the Trilogy Care Stall Detection Dashboard. To stop receiving these alerts, contact your team leader.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: env.FROM_EMAIL,
            to: [actualTo],
            subject,
            html,
          }),
        });
        const emailData = await emailResp.json();
        if (!emailResp.ok) return json({ error: emailData.message || 'Email failed', detail: emailData }, emailResp.status);
        return json({ success: true, id: emailData.id, to });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── /email-breakdown — send full overdue breakdown email per rep ───
    if (path === '/email-breakdown') {
      if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 500);
      if (!env.FROM_EMAIL)     return json({ error: 'FROM_EMAIL not configured' }, 500);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { to, rep_name, consumers, zoho_base } = body;
      if (!to || !rep_name || !consumers || !consumers.length) return json({ error: 'Missing required fields: to, rep_name, consumers' }, 400);

      const actualTo = env.TEST_EMAIL || to;

      const criticals = consumers.filter(c => c.severity === 'critical');
      const warnings = consumers.filter(c => c.severity === 'warning');
      const noHCA = consumers.filter(c => !c.verbal_hca);
      const overdue = consumers.filter(c => c.closing_overdue);

      const consumerRows = consumers.map(c => {
        const sevColor = c.severity === 'critical' ? '#ef4444' : c.severity === 'warning' ? '#c8953a' : '#6b7280';
        const sevLabel = c.severity === 'critical' ? 'CRITICAL' : c.severity === 'warning' ? 'WARNING' : 'WATCH';
        const zohoUrl = zoho_base ? `${zoho_base}/${c.id}` : '';
        const gapText = (c.gaps || []).join(' · ');
        return `
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:12px 8px;font-size:13px;color:#111827;font-weight:500;vertical-align:top">
              ${c.name}
              ${zohoUrl ? `<br><a href="${zohoUrl}" style="font-size:11px;color:#1a5c5c;text-decoration:none">Open in Zoho →</a>` : ''}
            </td>
            <td style="padding:12px 8px;font-size:11px;vertical-align:top">
              <span style="background:${sevColor}15;color:${sevColor};padding:2px 8px;border-radius:10px;font-weight:500">${sevLabel}</span>
            </td>
            <td style="padding:12px 8px;font-size:12px;color:#6b7280;vertical-align:top">${c.hcp || '—'}</td>
            <td style="padding:12px 8px;font-size:12px;color:#6b7280;vertical-align:top">${c.cp_stage || '—'}</td>
            <td style="padding:12px 8px;font-size:12px;color:${(c.days_inactive||0) > 14 ? '#ef4444' : '#6b7280'};vertical-align:top;font-weight:${(c.days_inactive||0) > 14 ? '600' : '400'}">${c.days_inactive || 0}d</td>
            <td style="padding:12px 8px;font-size:12px;color:${c.closing_overdue ? '#ef4444' : '#6b7280'};vertical-align:top;font-weight:${c.closing_overdue ? '600' : '400'}">${c.closing_overdue ? c.closing_overdue + 'd' : '—'}</td>
            <td style="padding:12px 8px;font-size:11px;color:#6b7280;vertical-align:top">${gapText || '—'}</td>
          </tr>`;
      }).join('');

      const subject = `${rep_name} — Overdue consumer breakdown (${criticals.length} critical, ${warnings.length} warning)`;

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f5ee;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f5ee;padding:32px 0">
    <tr><td align="center">
      <table width="720" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <tr><td style="background:#1a5c5c;padding:20px 32px">
          <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:0.04em;font-family:Georgia,serif">Trilogy <span style="color:#c8953a">Care</span></span>
          <span style="color:rgba(255,255,255,0.6);font-size:12px;margin-left:16px;font-family:monospace"> · Overdue Consumer Breakdown</span>
        </td></tr>
        <tr><td style="padding:32px">
          <h2 style="margin:0 0 4px;font-size:20px;color:#0f0f0f">Hi ${rep_name.split(' ')[0]},</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6">
            Here is your complete overdue consumer breakdown as of today. Please prioritise the critical items and action the verbal HCA calls.
          </p>

          <!-- Summary stats -->
          <table style="width:100%;margin-bottom:24px;border-collapse:collapse">
            <tr>
              <td style="background:#fef2f2;border-radius:8px;padding:14px;text-align:center;width:25%">
                <div style="font-size:24px;font-weight:700;color:#c0392b;font-family:monospace">${criticals.length}</div>
                <div style="font-size:10px;color:#c0392b;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Critical</div>
              </td>
              <td style="width:8px"></td>
              <td style="background:#fef8ee;border-radius:8px;padding:14px;text-align:center;width:25%">
                <div style="font-size:24px;font-weight:700;color:#c8953a;font-family:monospace">${warnings.length}</div>
                <div style="font-size:10px;color:#c8953a;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Warning</div>
              </td>
              <td style="width:8px"></td>
              <td style="background:#f0faf4;border-radius:8px;padding:14px;text-align:center;width:25%">
                <div style="font-size:24px;font-weight:700;color:#1d6b3e;font-family:monospace">${noHCA.length}</div>
                <div style="font-size:10px;color:#1d6b3e;text-transform:uppercase;letter-spacing:1px;margin-top:2px">No HCA</div>
              </td>
              <td style="width:8px"></td>
              <td style="background:#eef6f6;border-radius:8px;padding:14px;text-align:center;width:25%">
                <div style="font-size:24px;font-weight:700;color:#1a5c5c;font-family:monospace">${consumers.length}</div>
                <div style="font-size:10px;color:#1a5c5c;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Total</div>
              </td>
            </tr>
          </table>

          <!-- Consumer table -->
          <table style="width:100%;border-collapse:collapse;font-family:'Segoe UI',Arial,sans-serif">
            <tr style="background:#f9f5ee;border-bottom:2px solid #d4c9b0">
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">Consumer</th>
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">Status</th>
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">HCP</th>
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">CP Stage</th>
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">Inactive</th>
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">Overdue</th>
              <th style="padding:8px;font-size:11px;color:#1a5c5c;text-transform:uppercase;letter-spacing:0.5px;text-align:left;font-weight:600">Issues</th>
            </tr>
            ${consumerRows}
          </table>

          <div style="background:#fef3c7;border-radius:8px;padding:14px 16px;margin-top:24px;border-left:4px solid #c8953a">
            <p style="margin:0;font-size:13px;color:#92400e;font-weight:500">Priority: Focus on the ${criticals.length} critical consumer${criticals.length !== 1 ? 's' : ''} first — make verbal HCA calls today and log in Zoho.</p>
          </div>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0">
          <p style="margin:0;font-size:12px;color:#9ca3af">This breakdown was sent by the Trilogy Care Onboarding Stall Dashboard.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: env.FROM_EMAIL,
            to: [actualTo],
            subject,
            html,
          }),
        });
        const emailData = await emailResp.json();
        if (!emailResp.ok) return json({ error: emailData.message || 'Email failed', detail: emailData }, emailResp.status);
        return json({ success: true, id: emailData.id, to: actualTo });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return json({ error: `Unknown route: ${path}. Use /nudge, /email, or /email-breakdown` }, 404);
  }
};
