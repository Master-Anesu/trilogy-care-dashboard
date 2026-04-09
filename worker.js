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
            to: [to],
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

    return json({ error: `Unknown route: ${path}. Use /nudge or /email` }, 404);
  }
};
