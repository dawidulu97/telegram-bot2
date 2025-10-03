// api/telegram-webhook.js
export const config = { runtime: 'edge' };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;             // "7557313062" or "-100…"
const WEBHOOK_SECRET_TOKEN = process.env.WEBHOOK_SECRET_TOKEN; // "lola2"

const tg = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
};

const updateHWIDStatus = async (hwid, status) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/hwid_approvals?hwid=eq.${encodeURIComponent(hwid)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status} ${await r.text()}`);
};

const pickHWID = (s) => (s && (s.match(/[A-Fa-f0-9]{64}/) || [])[0]) || null;
const asStr = (v) => (typeof v === 'number' ? String(v) : (v || ''));

export default async function handler(req) {
  // GET = health check + send test message to admin
  if (req.method !== 'POST') {
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      try { await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, text: 'Webhook alive ✅' }); } catch {}
    }
    return new Response('OK', { status: 200 });
  }

  // Verify Telegram secret header (if configured)
  if (WEBHOOK_SECRET_TOKEN) {
    const got = req.headers.get('x-telegram-bot-api-secret-token');
    if (got !== WEBHOOK_SECRET_TOKEN) return new Response('OK', { status: 200 });
  }

  try {
    const update = await req.json();

    // Inline button callbacks
    if (update?.callback_query) {
      const cq = update.callback_query;
      if (ADMIN_CHAT_ID && asStr(cq?.message?.chat?.id) !== ADMIN_CHAT_ID) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Not authorized' });
        return new Response('OK', { status: 200 });
      }
      const [action, hwid] = String(cq.data || '').split(':');
      const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
      const status = map[action];
      if (!status || !hwid) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Invalid action' });
        return new Response('OK', { status: 200 });
      }
      await updateHWIDStatus(hwid, status);
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `HWID ${status}` });
      const emoji = { approved: '✅', rejected: '❌', hold: '⏸️' }[status];
      await tg('editMessageText', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `${emoji} HWID ${status.toUpperCase()}\n\nHWID: ${hwid}\n\nUpdated at ${new Date().toISOString()}`,
      });
      return new Response('OK', { status: 200 });
    }

    // Text commands: /approve|/reject|/hold [HWID] or reply to HWID message
    if (typeof update?.message?.text === 'string') {
      const msg = update.message;
      if (ADMIN_CHAT_ID && asStr(msg?.chat?.id) !== ADMIN_CHAT_ID) return new Response('OK', { status: 200 });

      const text = msg.text.trim();
      const m = text.match(/^\/(approve|reject|hold)(?:\s+([A-Fa-f0-9]{64}))?$/i);
      if (m) {
        const action = m[1].toLowerCase();
        let hwid = m[2] || null;
        if (!hwid && msg.reply_to_message?.text) hwid = pickHWID(msg.reply_to_message.text);

        if (!hwid) {
          await tg('sendMessage', { chat_id: msg.chat.id, text: '❌ Missing HWID. Reply to the HWID message with /approve or include the HWID.' });
        } else {
          const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
          await updateHWIDStatus(hwid, map[action]);
          await tg('sendMessage', { chat_id: msg.chat.id, text: `✅ Status updated to ${map[action].toUpperCase()} for HWID ${hwid}` });
        }
        return new Response('OK', { status: 200 });
      }
    }

    return new Response('OK', { status: 200 });
  } catch {
    return new Response('OK', { status: 200 });
  }
}